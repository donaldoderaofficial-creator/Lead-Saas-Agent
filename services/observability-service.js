function createObservabilityService({
  config,
  releaseAttribution,
  checkDatabase,
  buildProductionSmokeCheckStatus,
  logger,
  cache,
  rateLimiter,
  businessMetrics,
  env = process.env,
  packageVersion = require('../package.json').version,
  now = () => new Date(),
  uptime = () => process.uptime(),
}) {
  function getDeploymentStatus() {
    return buildProductionSmokeCheckStatus({
      env: config.env,
      sessionSecret: config.sessionSecret,
      publicAppUrl: config.publicAppUrl,
      corsOrigins: config.security.corsOrigins,
      paypal: { ...config.payment.paypal, enabled: config.payment.paypal.configured },
      mpesa: {
        ...config.payment.mpesa,
        enabled: config.payment.mpesa.configured,
        callbackUrl: env.MPESA_CALLBACK_URL,
      },
      wallets: config.wallets,
    });
  }

  return {
    getHealth() {
      return {
        status: 'ok',
        release: {
          version: packageVersion,
          build: env.BUILD_SHA || env.RENDER_GIT_COMMIT || 'local',
          attribution: releaseAttribution,
        },
        timestamp: now().toISOString(),
        uptime: uptime(),
        prospecting: Boolean(env.EXPLORIUM_API_KEY),
      };
    },

    getReadiness() {
      const database = checkDatabase();
      const deployment = getDeploymentStatus();
      const ready = database.status === 'ok' && deployment.status !== 'not_ready';
      return {
        statusCode: ready ? 200 : 503,
        body: {
          status: ready ? 'ready' : 'not_ready',
          timestamp: now().toISOString(),
          database,
          deployment,
        },
      };
    },

    getDeploymentSmoke() {
      const deployment = getDeploymentStatus();
      return {
        statusCode: deployment.status === 'ready' ? 200 : 503,
        body: {
          status: deployment.status,
          timestamp: now().toISOString(),
          missing: deployment.missing,
          checks: deployment.checks,
        },
      };
    },

    getMetrics() {
      return {
        logger: logger.getMetrics(),
        cache: cache.stats(),
        rateLimiter: rateLimiter.userLimits.size,
        business: businessMetrics(),
      };
    },
  };
}

module.exports = { createObservabilityService };
