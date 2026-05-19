// server/jobs/metaTokenRefresh.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const META_API_VERSION = "v24.0";

// Token expiry buffer: refresh 7 days before expiry
const REFRESH_BUFFER_DAYS = 7;
const REFRESH_BUFFER_SECONDS = REFRESH_BUFFER_DAYS * 24 * 60 * 60;

/**
 * Read and parse .env file
 */
function readEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('server/.env file not found');
  }
  return fs.readFileSync(envPath, 'utf8');
}

/**
 * Update a key-value pair in .env file
 */
function updateEnvKey(key, value) {
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = readEnvFile();
  
  const regex = new RegExp(`^${key}=.*`, 'm');
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `${key}=${value}`);
  } else {
    envContent += `\n${key}=${value}`;
  }
  
  fs.writeFileSync(envPath, envContent.trim() + '\n');
}

/**
 * Get token expiry from Meta API debug endpoint
 * Returns expiry timestamp in seconds, or null if unable to determine
 */
async function getTokenExpiry(accessToken) {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/${META_API_VERSION}/debug_token`,
      {
        params: {
          input_token: accessToken,
          access_token: accessToken
        },
        timeout: 10000
      }
    );
    
    if (response.data && response.data.data && response.data.data.expires_at) {
      return response.data.data.expires_at;
    }
    return null;
  } catch (error) {
    console.error('[TokenRefresh] Error checking token expiry:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Exchange short-lived token for long-lived token, or refresh existing long-lived token
 * Uses Meta's oauth/access_token endpoint with grant_type=fb_exchange_token
 * API Format: https://graph.facebook.com/v24.0/oauth/access_token?grant_type=fb_exchange_token&client_id={META_APP_ID}&client_secret={META_APP_SECRET}&fb_exchange_token={META_ACCESS_TOKEN}
 */
async function refreshAccessToken() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const currentToken = process.env.META_ACCESS_TOKEN;

  if (!appId || !appSecret || !currentToken) {
    console.error('[TokenRefresh] Missing required credentials: META_APP_ID, META_APP_SECRET, or META_ACCESS_TOKEN');
    return { success: false, error: 'Missing required credentials in .env file' };
  }

  try {
    // Exchange token for long-lived token using Meta's oauth/access_token endpoint
    // Format matches: https://graph.facebook.com/v24.0/oauth/access_token?grant_type=fb_exchange_token&client_id={META_APP_ID}&client_secret={META_APP_SECRET}&fb_exchange_token={META_ACCESS_TOKEN}
    const response = await axios.get(
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`,
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: currentToken
        },
        timeout: 30000
      }
    );

    if (!response.data || !response.data.access_token) {
      console.error('[TokenRefresh] ❌ Invalid response from Meta API:', response.data);
      return { success: false, error: 'Invalid response from Meta API' };
    }

    const newToken = response.data.access_token;
    const expiresIn = response.data.expires_in || 5183944; // Default to ~60 days if not provided
    
    // Calculate expiry date
    const expiryDate = new Date(Date.now() + (expiresIn * 1000));
    
    // Update .env file with new token
    updateEnvKey('META_ACCESS_TOKEN', newToken);
    
    // Update process.env in memory
    process.env.META_ACCESS_TOKEN = newToken;
    
    return {
      success: true,
      expiresIn,
      expiresAt: expiryDate.toISOString()
    };
    
  } catch (error) {
    console.error('[TokenRefresh] ========================================');
    console.error('[TokenRefresh] ❌ Error refreshing token!');
    console.error('[TokenRefresh] Error Status:', error.response?.status);
    console.error('[TokenRefresh] Error Response:', JSON.stringify(error.response?.data || error.message, null, 2));
    
    if (error.response?.data?.error) {
      console.error('[TokenRefresh] Error Code:', error.response.data.error.code);
      console.error('[TokenRefresh] Error Message:', error.response.data.error.message);
      console.error('[TokenRefresh] Error Type:', error.response.data.error.type);
    }
    
    // Check if token is expired
    if (error.response?.data?.error?.code === 190) {
      console.error('[TokenRefresh] Token is expired. Please generate a new token from Facebook Graph API Explorer and update META_ACCESS_TOKEN in server/.env file');
      console.error('[TokenRefresh] ========================================');
      return {
        success: false,
        error: 'Token is expired. Please generate a new token from Facebook Graph API Explorer and update META_ACCESS_TOKEN in server/.env file'
      };
    }
    
    console.error('[TokenRefresh] ========================================');
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message || 'Unknown error refreshing token'
    };
  }
}

/**
 * Check if token needs refresh and refresh if necessary
 */
async function checkAndRefreshToken() {
  const currentToken = process.env.META_ACCESS_TOKEN;
  
  if (!currentToken) {
    return { success: false, error: 'No token to refresh' };
  }

  try {
    // Check token expiry
    const expiresAt = await getTokenExpiry(currentToken);
    
    if (!expiresAt) {
      return await refreshAccessToken();
    }
    
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiresAt - now;
    const daysUntilExpiry = timeUntilExpiry / 86400;
    
    // Refresh if token expires within the buffer period
    if (timeUntilExpiry <= REFRESH_BUFFER_SECONDS) {
      return await refreshAccessToken();
    } else {
      return {
        success: true,
        message: 'Token is still valid',
        daysUntilExpiry: Math.round(daysUntilExpiry)
      };
    }
  } catch (error) {
    console.error('[TokenRefresh] ❌ Error checking token:', error.message);
    // If we can't check expiry, try refreshing anyway (might be a short-lived token)
    return await refreshAccessToken();
  }
}

/**
 * Refresh system access token if configured
 * Uses the same Meta oauth/access_token endpoint format as refreshAccessToken()
 * API Format: https://graph.facebook.com/v24.0/oauth/access_token?grant_type=fb_exchange_token&client_id={META_APP_ID}&client_secret={META_APP_SECRET}&fb_exchange_token={META_SYSTEM_ACCESS_TOKEN}
 */
async function refreshSystemToken() {
  const systemToken = process.env.META_SYSTEM_ACCESS_TOKEN;

  if (!systemToken) {
    return { success: true, message: 'System token not configured' };
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    console.error('[TokenRefresh] Missing META_APP_ID or META_APP_SECRET for system token refresh');
    return { success: false, error: 'Missing app credentials' };
  }

  try {
    // Exchange system token for long-lived token using Meta's oauth/access_token endpoint
    // Format matches: https://graph.facebook.com/v24.0/oauth/access_token?grant_type=fb_exchange_token&client_id={META_APP_ID}&client_secret={META_APP_SECRET}&fb_exchange_token={META_SYSTEM_ACCESS_TOKEN}
    const response = await axios.get(
      `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`,
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: systemToken
        },
        timeout: 30000
      }
    );

    if (!response.data || !response.data.access_token) {
      console.error('[TokenRefresh] ❌ Invalid response from Meta API:', response.data);
      console.error('[TokenRefresh] ========================================');
      return { success: false, error: 'Invalid response from Meta API' };
    }

    const newToken = response.data.access_token;
    const expiresIn = response.data.expires_in || 5183944;
    
    updateEnvKey('META_SYSTEM_ACCESS_TOKEN', newToken);
    process.env.META_SYSTEM_ACCESS_TOKEN = newToken;
    
    return {
      success: true,
      expiresIn
    };
    
  } catch (error) {
    console.error('[TokenRefresh] ========================================');
    console.error('[TokenRefresh] ❌ Error refreshing system token!');
    console.error('[TokenRefresh] Error Status:', error.response?.status);
    console.error('[TokenRefresh] Error Response:', JSON.stringify(error.response?.data || error.message, null, 2));
    
    if (error.response?.data?.error) {
      console.error('[TokenRefresh] Error Code:', error.response.data.error.code);
      console.error('[TokenRefresh] Error Message:', error.response.data.error.message);
      console.error('[TokenRefresh] Error Type:', error.response.data.error.type);
    }
    
    // Check if token is expired (same as user token)
    if (error.response?.data?.error?.code === 190) {
      console.error('[TokenRefresh] System token is expired. Generate a new token from Meta Business Suite (System Users) and update META_SYSTEM_ACCESS_TOKEN in server/.env');
      console.error('[TokenRefresh] ========================================');
      return {
        success: false,
        error: 'Token is expired. Generate a new token from Meta Business Suite (System Users) and update META_SYSTEM_ACCESS_TOKEN in server/.env'
      };
    }

    console.error('[TokenRefresh] ========================================');
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message
    };
  }
}

/**
 * Check if system token needs refresh and refresh if necessary (same logic as checkAndRefreshToken)
 */
async function checkAndRefreshSystemToken() {
  const currentToken = process.env.META_SYSTEM_ACCESS_TOKEN;

  if (!currentToken) {
    return { success: true, message: 'System token not configured' };
  }

  try {
    const expiresAt = await getTokenExpiry(currentToken);

    if (!expiresAt) {
      return await refreshSystemToken();
    }

    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = expiresAt - now;
    const daysUntilExpiry = timeUntilExpiry / 86400;

    if (timeUntilExpiry <= REFRESH_BUFFER_SECONDS) {
      return await refreshSystemToken();
    }
    return {
      success: true,
      message: 'System token is still valid',
      daysUntilExpiry: Math.round(daysUntilExpiry)
    };
  } catch (error) {
    console.error('[TokenRefresh] ❌ Error checking system token:', error.message);
    return await refreshSystemToken();
  }
}

/**
 * Main function to check and refresh all tokens (user and system)
 */
async function refreshAllTokens() {
  const results = {
    accessToken: null,
    systemAccessToken: null
  };

  results.accessToken = await checkAndRefreshToken();
  results.systemAccessToken = await checkAndRefreshSystemToken();

  return results;
}

/**
 * Start token refresh scheduler
 * Checks and refreshes tokens on startup, then daily
 */
/**
 * Test function to manually test token refresh
 * Call this function to test the token refresh API
 */
async function testTokenRefresh() {
  // Check environment variables
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const accessToken = process.env.META_ACCESS_TOKEN;
  
  if (!appId || !appSecret || !accessToken) {
    console.error('[TokenRefresh] ❌ Missing required environment variables!');
    console.error('[TokenRefresh] Please ensure META_APP_ID, META_APP_SECRET, and META_ACCESS_TOKEN are set in server/.env');
    return { success: false, error: 'Missing environment variables' };
  }
  
  // Test the refresh
  const result = await refreshAccessToken();
  
  return result;
}

function startTokenRefreshScheduler() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const accessToken = process.env.META_ACCESS_TOKEN;
  const systemToken = process.env.META_SYSTEM_ACCESS_TOKEN;

  if (!appId || !appSecret) {
    console.warn('[TokenRefresh] ⚠️  Scheduler not started - Missing META_APP_ID or META_APP_SECRET in .env file');
    return null;
  }
  if (!accessToken && !systemToken) {
    console.warn('[TokenRefresh] ⚠️  Scheduler not started - Set META_ACCESS_TOKEN and/or META_SYSTEM_ACCESS_TOKEN in .env file');
    return null;
  }

  // Run immediately on startup
  refreshAllTokens().catch(err => {
    console.error('\n[TokenRefresh] ❌ Error in initial token check:', err.message);
  });
  
  // Then run daily (24 hours)
  const intervalId = setInterval(() => {
    refreshAllTokens().catch(err => {
      console.error('\n[TokenRefresh] ❌ Error in scheduled token check:', err.message);
    });
  }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
  
  return intervalId;
}

module.exports = {
  refreshAccessToken,
  refreshSystemToken,
  checkAndRefreshToken,
  checkAndRefreshSystemToken,
  refreshAllTokens,
  startTokenRefreshScheduler,
  testTokenRefresh
};
