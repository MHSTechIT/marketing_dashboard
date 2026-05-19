// server/import-users-supabase.js
// Import users from JSON/CSV file into Supabase
// Useful when SQL Server is not directly accessible

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { supabase, verifyTableExists } = require('./supabase');
const fs = require('fs');
const path = require('path');

// Expected JSON format:
// [
//   {
//     "email": "user@example.com",
//     "password_hash": "$2b$10$...",
//     "full_name": "User Name",
//     "created_at": "2024-01-01T00:00:00Z" (optional)
//   }
// ]

async function importUsers(filePath) {
  console.log('📥 Importing users from file...\n');

  if (!supabase) {
    console.error('❌ Supabase not configured!');
    console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  // Verify table exists
  console.log('1. Verifying table exists...');
  const tableCheck = await verifyTableExists('Users');
  if (!tableCheck.exists && !tableCheck.isCacheIssue) {
    console.error('❌ Users table does not exist in Supabase!');
    console.error('   Please create the table first using the SQL from supabase-schema.sql');
    process.exit(1);
  }
  console.log('✅ Table exists (or schema cache needs refresh)\n');

  // Read file
  console.log('2. Reading file...');
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    console.error('\n📝 Expected file format (JSON):');
    console.error(JSON.stringify([
      {
        email: "user@example.com",
        password_hash: "$2b$10$...",
        full_name: "User Name"
      }
    ], null, 2));
    process.exit(1);
  }

  let users;
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    users = JSON.parse(fileContent);
    if (!Array.isArray(users)) {
      throw new Error('JSON file must contain an array of user objects');
    }
    console.log(`✅ Loaded ${users.length} user(s) from file\n`);
  } catch (err) {
    console.error(`❌ Error reading file: ${err.message}`);
    console.error('   Make sure the file is valid JSON with an array of users');
    process.exit(1);
  }

  // Migrate users
  console.log('3. Importing users to Supabase...\n');
  let imported = 0;
  let skipped = 0;
  const errors = [];

  for (const user of users) {
    try {
      // Validate required fields
      if (!user.email || !user.password_hash) {
        console.error(`   ⚠️  Skipping user - missing email or password_hash`);
        skipped++;
        continue;
      }

      // Check if user already exists (using correct table and column names)
      const { data: existing } = await supabase
        .from('Users')
        .select('Id')
        .eq('Email', user.email)
        .maybeSingle();

      if (existing) {
        console.log(`   ⏭️  Skipping ${user.email} (already exists)`);
        skipped++;
        continue;
      }

      // Insert user into Supabase (using correct table and column names)
      const { data, error } = await supabase
        .from('Users')
        .insert([
          {
            Email: user.email,
            PasswordHash: user.password_hash,
            FullName: user.full_name || null,
            Role: user.role || 'user',
            CreatedAt: user.created_at || new Date().toISOString()
          }
        ])
        .select('Id, Email')
        .single();

      if (error) {
        if (error.code === 'PGRST116' || error.message?.includes('schema cache')) {
          console.error(`   ⚠️  Schema cache issue for ${user.email}`);
          console.error('   Please refresh schema cache and try again');
          errors.push({ email: user.email, error: 'Schema cache issue' });
        } else {
          console.error(`   ❌ Failed to import ${user.email}:`, error.message);
          errors.push({ email: user.email, error: error.message });
        }
      } else {
        console.log(`   ✅ Imported ${user.email} (ID: ${data.Id})`);
        imported++;
      }
    } catch (err) {
      console.error(`   ❌ Error importing ${user.email}:`, err.message);
      errors.push({ email: user.email, error: err.message });
    }
  }

  console.log('\n📊 Import Summary:');
  console.log(`   ✅ Imported: ${imported}`);
  console.log(`   ⏭️  Skipped: ${skipped}`);
  console.log(`   ❌ Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\n❌ Errors encountered:');
    errors.forEach((e, i) => {
      console.log(`   ${i + 1}. ${e.email}: ${e.error}`);
    });
  }

  if (errors.some(e => e.error?.includes('schema cache'))) {
    console.log('\n⚠️  Schema Cache Issue Detected!');
    console.log('   Please refresh the schema cache:');
    console.log('   1. Go to Supabase Dashboard → Settings → API');
    console.log('   2. Click "Reload schema" button');
    console.log('   3. Wait 30-60 seconds');
    console.log('   4. Run this script again');
  }

  return { imported, skipped, errors };
}

// Main
const filePath = process.argv[2] || 'users-export.json';

if (!filePath || filePath === '--help' || filePath === '-h') {
  console.log('📥 Import Users to Supabase\n');
  console.log('Usage:');
  console.log('  node import-users-supabase.js [file-path]\n');
  console.log('Example:');
  console.log('  node import-users-supabase.js users-export.json\n');
  console.log('Expected JSON format:');
  console.log(JSON.stringify([
    {
      email: "user@example.com",
      password_hash: "$2b$10$...",
      full_name: "User Name",
      created_at: "2024-01-01T00:00:00Z" // optional
    }
  ], null, 2));
  console.log('\n💡 To export from SQL Server, run this query:');
  console.log('   SELECT Email, PasswordHash, FullName, CreatedAt FROM Users');
  console.log('   Export results as JSON');
  process.exit(0);
}

importUsers(filePath).catch(err => {
  console.error('❌ Import failed:', err.message);
  process.exit(1);
});

