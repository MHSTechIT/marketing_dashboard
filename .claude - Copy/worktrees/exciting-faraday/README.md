# Marketing Dashboard

A comprehensive marketing analytics dashboard for tracking Meta (Facebook) ads, leads, and content marketing performance.

## Features

- 📊 **Ads Analytics Dashboard** - Track campaign performance, leads, CPL, CTR, and more
- 📱 **Content Marketing Dashboard** - Monitor organic leads, followers, reach, and engagement
- 🎯 **Lead Management** - View and export leads from Meta forms
- 📈 **Real-time Insights** - Performance metrics from Meta API
- 🔄 **Google Sheets Integration** - Revenue tracking from Google Sheets
- 🎨 **Modern UI** - Clean, responsive design with dark/light theme support

## Tech Stack

### Frontend
- React.js
- Recharts (for charts)
- Bootstrap 5
- Custom CSS

### Backend
- Node.js
- Express.js
- Meta Graph API
- Google Sheets API
- SQL Server (for leads storage)

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- SQL Server (for leads database)
- Meta Access Token with required permissions
- Google Sheets API credentials (for revenue tracking)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yuvarajamhs-creator/Marketing-Dashboard.git
   cd Marketing-Dashboard
   ```

2. **Install dependencies:**
   
   For server:
   ```bash
   cd server
   npm install
   ```
   
   For client:
   ```bash
   cd client
   npm install
   ```

3. **Configure environment variables:**
   
   Create `server/.env` file:
   ```env
   META_ACCESS_TOKEN=your_meta_access_token
   META_AD_ACCOUNT_ID=your_ad_account_id
   META_APP_ID=your_app_id
   META_APP_SECRET=your_app_secret
   META_SYSTEM_ACCESS_TOKEN=your_system_token
   # META_SYSTEM_ACCESS_TOKEN must include instagram_manage_insights and pages_read_engagement for Instagram Insights and Page Insights.
   
   DB_SERVER=your_db_server
   DB_DATABASE=your_database
   DB_USER=your_username
   DB_PASSWORD=your_password
   DB_PORT=1433
   
   GOOGLE_SHEETS_SPREADSHEET_ID=your_sheet_id
   GOOGLE_SHEETS_CLIENT_EMAIL=your_service_account_email
   GOOGLE_SHEETS_PRIVATE_KEY=your_private_key
   ```

4. **Start the servers:**
   
   Server (from `server/` directory):
   ```bash
   npm start
   ```
   
   Client (from `client/` directory):
   ```bash
   npm start
   ```

5. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:4000

## Project Structure

```
Marketing-Dashboard/
├── client/                 # React frontend application
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── pages/         # Page components
│   │   ├── utils/         # Utility functions
│   │   └── ...
│   └── package.json
├── server/                 # Node.js backend
│   ├── meta/              # Meta API integration
│   ├── jobs/              # Background jobs (leads sync)
│   ├── repositories/      # Data repositories
│   ├── services/          # Business logic
│   └── server.js          # Express server
├── docs/                  # Documentation
└── README.md
```

## Meta API Permissions Required

- `ads_read` - Read ad account data
- `ads_management` - Manage ads (optional)
- `leads_retrieval` - Access lead data
- `pages_read_engagement` - Read page insights
- `business_management` - Access business accounts (optional)

See `META_PERMISSIONS_GUIDE.md` for detailed setup instructions.

## Features Overview

### Ads Analytics Dashboard
- Campaign performance metrics
- Ad-level breakdown
- Leads tracking
- Cost per lead (CPL) analysis
- Click-through rate (CTR)
- Hook rate and hold rate for video ads
- Revenue tracking (L1, L2, Total)

### Content Marketing Dashboard
- Page followers and reach
- Organic leads tracking
- Content performance insights
- Platform analytics
- Source-based lead analysis

### Lead Management
- View leads from Meta forms
- Filter by campaign, ad, date range
- Export to CSV/Excel
- Lead details with contact information

## Development

### Running in Development Mode

Server:
```bash
cd server
npm run dev
```

Client:
```bash
cd client
npm start
```

### Building for Production

Client:
```bash
cd client
npm run build
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Version Control

See `GIT_SETUP.md` for detailed Git setup instructions.

## Documentation

- [Meta Permissions Guide](META_PERMISSIONS_GUIDE.md)
- [Git Setup Guide](GIT_SETUP.md)
- [Server Startup Guide](START_SERVERS.md)

## License

This project is proprietary software.

## Support

For issues or questions, please open an issue on GitHub.

---

**Note:** Make sure to keep your `.env` files secure and never commit them to version control.

