# Ads Dashboard Server (MSSQL)

This server is configured to connect to your SQL Server instance:
DB_SERVER=DESKTOP-73IU3TA\\SQLEXPRESS (see .env.example)

## Setup

1. Copy .env.example to .env and update DB_PASSWORD (and other vars if needed).
2. Ensure SQL Server is running and accessible. For named instance DESKTOP-73IU3TA\\SQLEXPRESS make sure SQL Browser service is running.
3. Create the database and tables by running schema.sql in SQL Server Management Studio (SSMS), or let seed script create/assume DB exists.
4. Install dependencies:

```bash
cd ads-dashboard-server
npm install
```

5. Seed mock data (this will delete Ads & Leads tables content):

```bash
npm run seed
```

6. Start the server:

```bash
npm start
```

Server will run at http://localhost:4000.

## Endpoints

- POST /api/auth/signup  { email, password, fullName }
- POST /api/auth/login   { email, password }
- GET /api/auth/me       (requires Bearer token)
- GET /api/ads?days=30&includeLeads=1
- GET /api/leads?page=1&perPage=10&campaign=Alpha
- GET /api/campaigns
- GET /api/actions

Update server.js to require auth for ads/leads endpoints if you want to restrict access.
