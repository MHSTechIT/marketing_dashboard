// server/migrate-from-auth-users.js
// Migrate users from Supabase auth.users to public.users table

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');
const { supabase, verifyTableExists } = require('./supabase');

async function migrateFromAuthUsers() {
  console.log('🔄 Migrating users from auth.users to public.users...\n');

  if (!supabase) {
    console.error('❌ Supabase not configured!');
    console.error('   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env');
    process.exit(1);
  }

  // Verify public."Users" table exists
  console.log('1. Verifying public."Users" table exists...');
  const tableCheck = await verifyTableExists('Users');
  if (!tableCheck.exists && !tableCheck.isCacheIssue) {
    console.error('❌ public.users table does not exist!');
    console.error('   Please create the table first using the SQL from supabase-schema.sql');
    process.exit(1);
  }
  console.log('✅ Table exists (or schema cache needs refresh)\n');

  // Get users from auth.users using RPC
  console.log('2. Fetching users from auth.users...');
  
  try {
    // Try to call the migration function if it exists
    const { data: migrationResult, error: migrationError } = await supabase.rpc('migrate_auth_users_to_public');
    
    if (!migrationError && migrationResult && migrationResult.length > 0) {
      const result = migrationResult[0];
      console.log('\n📊 Migration Complete!');
      console.log(`   ✅ Migrated: ${result.migrated_count}`);
      console.log(`   ⏭️  Skipped: ${result.skipped_count}`);
      console.log(`   ❌ Errors: ${result.error_count}\n`);
      return;
    }

    // If migration function doesn't exist, try the helper function
    const { data: authUsers, error: authError } = await supabase.rpc('get_auth_users');

    if (authError && authError.code === 'P0001') {
      // Function doesn't exist - we need to create it or query directly
      console.log('⚠️  Cannot access auth.users directly via RPC');
      console.log('   Attempting to query via SQL...\n');
      
      // Alternative: Query via raw SQL using Supabase's REST API with SQL endpoint
      // Or create a function in Supabase to expose auth users
      console.log('📝 To migrate from auth.users, you need to:');
      console.log('   Option 1: Create a database function in Supabase SQL Editor:');
      console.log('   ─'.repeat(60));
      console.log(`
CREATE OR REPLACE FUNCTION get_auth_users()
RETURNS TABLE (
  id uuid,
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    au.id,
    au.email,
    au.encrypted_password,
    au.raw_user_meta_data,
    au.created_at
  FROM auth.users au;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
      `);
      console.log('   ─'.repeat(60));
      console.log('\n   Then run this migration script again.');
      console.log('\n   OR');
      console.log('\n   Option 2: Use Supabase Dashboard → Authentication → Users');
      console.log('   Export users manually and use import-users-supabase.js');
      
      return;
    }

    if (authError) {
      console.error('❌ Error fetching auth users:', authError.message);
      console.error('\n📝 Alternative: Use Supabase Dashboard to export users');
      console.error('   1. Go to Supabase Dashboard → Authentication → Users');
      console.error('   2. Export user data');
      console.error('   3. Use: node import-users-supabase.js exported-file.json');
      return;
    }

    if (!authUsers || authUsers.length === 0) {
      console.log('✅ No users found in auth.users');
      return;
    }

    console.log(`   Found ${authUsers.length} user(s) in auth.users\n`);

    // Migrate users
    console.log('3. Migrating users to public.users...\n');
    let migrated = 0;
    let skipped = 0;
    const errors = [];

    for (const authUser of authUsers) {
      try {
        // Check if user already exists in public."Users"
        const { data: existing } = await supabase
          .from('Users')
          .select('Id')
          .eq('Email', authUser.email)
          .maybeSingle();

        if (existing) {
          console.log(`   ⏭️  Skipping ${authUser.email} (already exists)`);
          skipped++;
          continue;
        }

        // Note: Supabase Auth uses bcrypt for password hashing
        // We need to use the encrypted_password from auth.users
        // But our public.users table expects password_hash
        
        // Extract password hash from auth.users
        // Supabase auth.users.encrypted_password is already a bcrypt hash
        const passwordHash = authUser.encrypted_password || authUser.password_hash;
        
        if (!passwordHash) {
          console.warn(`   ⚠️  Skipping ${authUser.email} - no password hash found`);
          skipped++;
          continue;
        }

        // Extract full name from metadata
        const fullName = authUser.raw_user_meta_data?.full_name || 
                        authUser.raw_user_meta_data?.fullName || 
                        authUser.raw_user_meta_data?.name || 
                        null;

        // Insert into public."Users" (using correct table and column names)
        const { data, error } = await supabase
          .from('Users')
          .insert([
            {
              Email: authUser.email,
              PasswordHash: passwordHash,
              FullName: fullName,
              Role: 'user',
              CreatedAt: authUser.created_at || new Date().toISOString()
            }
          ])
          .select('Id, Email')
          .single();

        if (error) {
          if (error.code === 'PGRST116' || error.message?.includes('schema cache')) {
            console.error(`   ⚠️  Schema cache issue for ${authUser.email}`);
            console.error('   Please refresh schema cache and try again');
            errors.push({ email: authUser.email, error: 'Schema cache issue' });
          } else {
            console.error(`   ❌ Failed to migrate ${authUser.email}:`, error.message);
            errors.push({ email: authUser.email, error: error.message });
          }
        } else {
          console.log(`   ✅ Migrated ${authUser.email} (ID: ${data.Id})`);
          migrated++;
        }
      } catch (err) {
        console.error(`   ❌ Error migrating ${authUser.email}:`, err.message);
        errors.push({ email: authUser.email, error: err.message });
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

  } catch (err) {
    console.error('❌ Migration error:', err.message);
    console.error('\n📝 Alternative migration method:');
    console.error('   1. Go to Supabase Dashboard → Authentication → Users');
    console.error('   2. Export user data manually');
    console.error('   3. Use: node import-users-supabase.js exported-file.json');
  }
}

// First, let's create a helper SQL function to access auth.users
async function showMigrationSQL() {
  console.log('📝 Migration SQL Script');
  console.log('─'.repeat(60));
  console.log('⚠️  IMPORTANT: Run the SQL from server/migrate-auth-users-direct.sql');
  console.log('   in your Supabase SQL Editor. This will:');
  console.log('   1. Create a migration function');
  console.log('   2. Migrate all users from auth.users to public.users');
  console.log('   3. Show migration summary\n');
  console.log('📋 Steps:');
  console.log('   1. Open: server/migrate-auth-users-direct.sql');
  console.log('   2. Go to Supabase Dashboard → SQL Editor');
  console.log('   3. Copy and paste the entire SQL script');
  console.log('   4. Click "Run"');
  console.log('   5. Check the results\n');
  
  // Also try to read and show the SQL file
  const fs = require('fs');
  const path = require('path');
  try {
    const sqlFile = path.join(__dirname, 'migrate-auth-users-direct.sql');
    if (fs.existsSync(sqlFile)) {
      const sql = fs.readFileSync(sqlFile, 'utf8');
      console.log('─'.repeat(60));
      console.log('SQL Script Preview:');
      console.log('─'.repeat(60));
      console.log(sql);
      console.log('─'.repeat(60));
    }
  } catch (err) {
    console.log('   (SQL file preview unavailable)');
  }
}

async function main() {
  console.log('🚀 Migrating from Supabase auth.users to public.users...\n');
  console.log('═'.repeat(60));
  console.log('');

  // Show SQL instructions if requested
  if (process.argv.includes('--show-sql') || process.argv.includes('--help')) {
    await showMigrationSQL();
    return;
  }

  await migrateFromAuthUsers();

  console.log('\n═'.repeat(60));
  console.log('✅ Migration process complete!');
  console.log('');
  console.log('📋 Next Steps:');
  console.log('   1. If function doesn\'t exist, run: node migrate-from-auth-users.js --create-function');
  console.log('   2. Create the helper function in Supabase SQL Editor');
  console.log('   3. Run this script again');
  console.log('   4. Verify: npm run verify-supabase');
  console.log('');
}

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

