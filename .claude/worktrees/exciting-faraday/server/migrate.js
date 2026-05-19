const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');

async function migrate() {
    try {
        const sqlContent = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
        const pool = await getPool();

        // Split by GO (case insensitive, on its own line)
        const batches = sqlContent.split(/^GO\s*$/m);

        for (const batch of batches) {
            const sql = batch.trim();
            if (!sql) continue;

            console.log('Executing batch...');
            try {
                await pool.request().query(sql);
                console.log('Batch executed successfully.');
            } catch (err) {
                // Ignore "database already exists" or "table already exists" if handled in SQL (IF EXISTS...),
                // but report others.
                console.error('Batch error:', err.message);
            }
        }

        console.log('Migration complete.');
    } catch (err) {
        console.error('Migration failed:', err);
    }
}

migrate();
