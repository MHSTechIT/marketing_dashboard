-- Export Users from SQL Server
-- Run this query in SQL Server Management Studio (SSMS) or Azure Data Studio
-- Export the results as JSON or CSV

-- Option 1: Export all users as JSON (for import-users-supabase.js)
SELECT 
    Email,
    PasswordHash as password_hash,
    FullName as full_name,
    CreatedAt as created_at
FROM dbo.Users
ORDER BY Id;

-- Option 2: Export as CSV (for manual import)
-- Use SSMS: Right-click query results → Save Results As → CSV

-- Option 3: Generate JSON directly (SQL Server 2016+)
SELECT 
    Email,
    PasswordHash as password_hash,
    FullName as full_name,
    FORMAT(CreatedAt, 'yyyy-MM-ddTHH:mm:ssZ') as created_at
FROM dbo.Users
FOR JSON PATH;

-- After exporting:
-- 1. Save the results as JSON file (e.g., users-export.json)
-- 2. Run: node import-users-supabase.js users-export.json

