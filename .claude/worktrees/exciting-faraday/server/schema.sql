-- Create database and tables (run in SSMS)
IF DB_ID('AdsDashboard') IS NULL
BEGIN
    CREATE DATABASE AdsDashboard;
END
GO

USE AdsDashboard;
GO

IF OBJECT_ID('dbo.Users') IS NULL
BEGIN
CREATE TABLE dbo.Users (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Email NVARCHAR(256) NOT NULL UNIQUE,
    PasswordHash NVARCHAR(512) NOT NULL,
    FullName NVARCHAR(256) NULL,
    Role NVARCHAR(50) DEFAULT 'user',
    CreatedAt DATETIME2 DEFAULT SYSUTCDATETIME()
);
END
GO

IF OBJECT_ID('dbo.Ads') IS NULL
BEGIN
CREATE TABLE dbo.Ads (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Campaign NVARCHAR(200) NOT NULL,
    DateChar CHAR(10) NOT NULL,
    Leads INT DEFAULT 0,
    Spend DECIMAL(18,2) DEFAULT 0,
    ActionsJson NVARCHAR(MAX) DEFAULT N'{}'
);
CREATE INDEX IX_Ads_DateChar ON dbo.Ads(DateChar);
END
GO

IF OBJECT_ID('dbo.Leads') IS NULL
BEGIN
CREATE TABLE dbo.Leads (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Name NVARCHAR(200),
    Phone NVARCHAR(100),
    TimeUtc DATETIME2,
    DateChar CHAR(10),
    Campaign NVARCHAR(200),
    ad_id NVARCHAR(100) NULL,
    campaign_id NVARCHAR(100) NULL,
    lead_id NVARCHAR(100) NULL,
    form_id NVARCHAR(100) NULL,
    page_id NVARCHAR(100) NULL,
    created_time DATETIME2 NULL,
    ad_name NVARCHAR(200) NULL
);
CREATE INDEX IX_Leads_DateChar ON dbo.Leads(DateChar);
END
GO

-- Add new columns if table already exists
IF OBJECT_ID('dbo.Leads') IS NOT NULL
BEGIN
    -- Add ad_id column if it doesn't exist
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'ad_id')
    BEGIN
        ALTER TABLE dbo.Leads ADD ad_id NVARCHAR(100) NULL;
    END
    
    -- Add campaign_id column if it doesn't exist
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'campaign_id')
    BEGIN
        ALTER TABLE dbo.Leads ADD campaign_id NVARCHAR(100) NULL;
    END
    
    -- Add lead_id column if it doesn't exist
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'lead_id')
    BEGIN
        ALTER TABLE dbo.Leads ADD lead_id NVARCHAR(100) NULL;
    END
    
    -- Add form_id column if it doesn't exist
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'form_id')
    BEGIN
        ALTER TABLE dbo.Leads ADD form_id NVARCHAR(100) NULL;
    END
    
    -- Add page_id column if it doesn't exist
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'page_id')
    BEGIN
        ALTER TABLE dbo.Leads ADD page_id NVARCHAR(100) NULL;
    END
    
    -- Add created_time column if it doesn't exist
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'created_time')
    BEGIN
        ALTER TABLE dbo.Leads ADD created_time DATETIME2 NULL;
    END
    
    -- Add ad_name column if it doesn't exist
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'ad_name')
    BEGIN
        ALTER TABLE dbo.Leads ADD ad_name NVARCHAR(200) NULL;
    END
END
GO

-- Create indexes for new columns
IF OBJECT_ID('dbo.Leads') IS NOT NULL
BEGIN
    -- Index for ad_id and campaign_id combination
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'idx_leads_ad_campaign')
    BEGIN
        CREATE INDEX idx_leads_ad_campaign ON dbo.Leads(ad_id, campaign_id);
    END
    
    -- Index for created_time
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'idx_leads_created_time')
    BEGIN
        CREATE INDEX idx_leads_created_time ON dbo.Leads(created_time);
    END
    
    -- Index for lead_id (unique constraint for duplicate prevention)
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Leads') AND name = 'idx_leads_lead_id')
    BEGIN
        CREATE UNIQUE INDEX idx_leads_lead_id ON dbo.Leads(lead_id) WHERE lead_id IS NOT NULL;
    END
END
GO

IF OBJECT_ID('dbo.MetaCredentials') IS NULL
BEGIN
CREATE TABLE dbo.MetaCredentials (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    UserId INT NOT NULL,
    AppId NVARCHAR(256) NOT NULL,
    AppSecret NVARCHAR(512) NOT NULL,
    AccessToken NVARCHAR(1024) NULL,
    AdAccountId NVARCHAR(256) NOT NULL,
    TokenExpiresAt DATETIME2 NULL,
    IsActive BIT DEFAULT 1,
    CreatedAt DATETIME2 DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 DEFAULT SYSUTCDATETIME(),
    FOREIGN KEY (UserId) REFERENCES dbo.Users(Id) ON DELETE CASCADE
);
CREATE INDEX IX_MetaCredentials_UserId ON dbo.MetaCredentials(UserId);
CREATE INDEX IX_MetaCredentials_IsActive ON dbo.MetaCredentials(IsActive);
END
GO

-- Simple key/value state store for background jobs (e.g., leads incremental sync cursor)
IF OBJECT_ID('dbo.JobState') IS NULL
BEGIN
CREATE TABLE dbo.JobState (
    JobKey NVARCHAR(200) NOT NULL PRIMARY KEY,
    JobValue NVARCHAR(MAX) NULL,
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
END
GO
