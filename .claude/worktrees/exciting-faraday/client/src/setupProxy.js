const { createProxyMiddleware } = require('http-proxy-middleware');

/**
 * Proxy only /api requests to the backend.
 * HMR and other dev-server requests (e.g. *.hot-update.json) stay local.
 * This avoids ECONNREFUSED proxy errors for non-API requests.
 */
module.exports = function (app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:4000',
      changeOrigin: true,
    })
  );
};
