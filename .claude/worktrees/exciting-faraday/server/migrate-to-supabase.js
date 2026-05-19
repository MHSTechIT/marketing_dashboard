// server/migrate-to-supabase.js
// Migration script to create users table in Supabase and optionally migrate data from SQL Server

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { supabase, verifyTableExists } = require('./supabase');
const fs = require('fs');
const path = require('path');

async function createTableInSupabase() {
  console.log('📋 Step 1: Creating users table in Supabase...\n');

  if (!supabase) {
    console.error('❌ Supabase not configured!');
    console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  // Read the schema SQL
  const schemaPath = path.join(__dirname, 'supabase-schema.sql');
  const schemaSQL = fs.readFileSync(schemaPath, 'utf8');

  console.log('⚠️  IMPORTANT: You need to run this SQL manually in Supabase SQL Editor:');
  console.log('   1. Go to Supabase Dashboard → SQL Editor');
  console.log('   2. Click "New Query"');
  console.log('   3. Copy the SQL below and paste it');
  console.log('   4. Click "Run" to execute\n');
  console.log('─'.repeat(60));
  console.log(schemaSQL);
  console.log('─'.repeat(60));
  console.log('\n📝 The SQL is also saved in: server/supabase-schema.sql');
  console.log('\n⏳ After running the SQL, wait 30-60 seconds for schema cache to refresh.');
  console.log('   Then you can run: npm run verify-supabase\n');
}

async function migrateUsersFromSQLServer() {
  console.log('📦 Step 2: Checking for existing users in SQL Server...\n');

  try {
    const { getPool, sql } = require('./db');
    const pool = await getPool();

    // Check if Users table exists in SQL Server
    const checkTable = await pool.request().query(`
      SELECT COUNT(*) as count 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Users'
    `);

    if (checkTable.recordset[0].count === 0) {
      console.log('✅ No Users table found in SQL Server - skipping data migration');
      return { migrated: 0, skipped: 0, errors: [] };
    }

    // Get all users from SQL Server
    const result = await pool.request().query(`
      SELECT Id, Email, PasswordHash, FullName, CreatedAt
      FROM dbo.Users
    `);

    const users = result.recordset;
    console.log(`   Found ${users.length} user(s) in SQL Server\n`);

    if (users.length === 0) {
      console.log('✅ No users to migrate - skipping data migration');
      return { migrated: 0, skipped: 0, errors: [] };
    }

    // Verify Supabase table exists
    const tableCheck = await verifyTableExists('users');
    if (!tableCheck.exists) {
      console.error('❌ Users table does not exist in Supabase!');
      console.error('   Please create the table first using Step 1');
      return { migrated: 0, skipped: users.length, errors: ['Table does not exist'] };
    }

    // Migrate users one by one
    let migrated = 0;
    let skipped = 0;
    const errors = [];

    console.log('📤 Migrating users to Supabase...\n');

    for (const user of users) {
      try {
        // Check if user already exists in Supabase
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('email', user.Email)
          .maybeSingle();

        if (existing) {
          console.log(`   ⏭️  Skipping ${user.Email} (already exists)`);
          skipped++;
          continue;
        }

        // Insert user into Supabase
        const { data, error } = await supabase
          .from('users')
          .insert([
            {
              email: user.Email,
              password_hash: user.PasswordHash,
              full_name: user.FullName || null,
              created_at: user.CreatedAt ? new Date(user.CreatedAt).toISOString() : null
            }
          ])
          .select('id, email')
          .single();

        if (error) {
          console.error(`   ❌ Failed to migrate ${user.Email}:`, error.message);
          errors.push({ email: user.Email, error: error.message });
        } else {
          console.log(`   ✅ Migrated ${user.Email} (ID: ${data.id})`);
          migrated++;
        }
      } catch (err) {
        console.error(`   ❌ Error migrating ${user.Email}:`, err.message);
        errors.push({ email: user.Email, error: err.message });
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach((e, i) => {
        console.log(`   ${i + 1}. ${e.email}: ${e.error}`);
      });
    }

    return { migrated, skipped, errors };

  } catch (err) {
    if (err.message?.includes('DB_SERVER') || err.message?.includes('not defined')) {
      console.log('⚠️  SQL Server not configured - skipping data migration');
      console.log('   (This is OK if you don\'t have existing users or are starting fresh)');
      return { migrated: 0, skipped: 0, errors: [] };
    }
    console.error('❌ Error connecting to SQL Server:', err.message);
    console.error('   Skipping data migration');
    return { migrated: 0, skipped: 0, errors: [err.message] };
  }
}

async function refreshSchemaCache() {
  console.log('\n🔄 Step 3: Refreshing Supabase schema cache...\n');

  if (!supabase) {
    console.log('⚠️  Supabase not configured - skipping schema refresh');
    return;
  }

  console.log('📝 To refresh schema cache manually:');
  console.log('   1. Go to Supabase Dashboard → Settings → API');
  console.log('   2. Click "Reload schema" button');
  console.log('   OR');
  console.log('   3. Run in SQL Editor: SELECT pg_notify(\'pgrst\', \'reload schema\');');
  console.log('   4. Wait 30-60 seconds\n');
}

async function main() {
  console.log('🚀 Starting Supabase Migration Process...\n');
  console.log('═'.repeat(60));
  console.log('');

  // Step 1: Create table
  await createTableInSupabase();

  // Step 2: Migrate data (optional)
  const shouldMigrate = process.argv.includes('--migrate-data') || 
                       process.argv.includes('-m');
  
  if (shouldMigrate) {
    await migrateUsersFromSQLServer();
  } else {
    console.log('📦 Step 2: Data Migration');
    console.log('   ⏭️  Skipped (use --migrate-data flag to migrate existing users)\n');
  }

  // Step 3: Refresh schema cache
  await refreshSchemaCache();

  console.log('═'.repeat(60));
  console.log('✅ Migration process complete!');
  console.log('');
  console.log('📋 Next Steps:');
  console.log('   1. Run the SQL from supabase-schema.sql in Supabase SQL Editor');
  console.log('   2. Wait 30-60 seconds for schema cache to refresh');
  console.log('   3. Run: npm run verify-supabase');
  console.log('   4. If you have existing users, run: node migrate-to-supabase.js --migrate-data');
  console.log('   5. Start your server: npm start');
  console.log('');
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

