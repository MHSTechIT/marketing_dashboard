const { getPool, sql } = require('./db');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function check() {
    console.log('\n=== Database Connection Test ===\n');
    
    // Display configuration
    const server = (process.env.DB_SERVER || '').trim();
    const port = process.env.DB_PORT;
    const database = process.env.DB_NAME;
    const hasInstanceName = server.includes('\\') || server.includes('/');
    
    console.log('Configuration:');
    console.log('  Server:', server);
    console.log('  Database:', database);
    console.log('  Port:', port || (hasInstanceName ? 'dynamic (via SQL Browser)' : 'default 1433'));
    console.log('  Connection Type:', hasInstanceName ? 'Named Instance' : 'IP:Port');
    console.log('');
    
    try {
        console.log('Attempting to connect...');
        const startTime = Date.now();
        const pool = await getPool();
        const connectTime = Date.now() - startTime;
        console.log(`✓ Connection successful! (${connectTime}ms)\n`);
        
        // Test query
        console.log('Testing database query...');
        const result = await pool.request().query("SELECT @@VERSION AS Version, DB_NAME() AS CurrentDatabase");
        console.log('✓ Query successful!');
        console.log('  Current Database:', result.recordset[0].CurrentDatabase);
        console.log('  SQL Server Version:', result.recordset[0].Version.split('\n')[0]);
        console.log('');
        
        // Check for MetaCredentials table
        const tableCheck = await pool.request().query("SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'MetaCredentials'");
        if (tableCheck.recordset.length > 0) {
            console.log("✓ Table 'MetaCredentials' EXISTS");
        } else {
            console.log("⚠ Table 'MetaCredentials' MISSING");
        }
        
        // Close the pool
        await pool.close();
        console.log('\n✓ Connection test completed successfully!');
        process.exit(0);
    } catch (e) {
        console.error('\n✗ Connection test FAILED\n');
        console.error('Error:', e.message);
        console.error('Code:', e.code || 'N/A');
        
        if (e.code === 'ESOCKET') {
            console.error('\nNetwork connectivity issue detected.');
            console.error('Please check:');
            console.error('  1. SQL Server is running');
            console.error('  2. Network/firewall allows connections');
            if (hasInstanceName) {
                console.error('  3. SQL Server Browser service is running');
            }
            console.error('  4. Server address and credentials are correct');
        }
        
        process.exit(1);
    }
}

check();
