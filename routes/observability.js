const express = require('express');

function createObservabilityRouter({ service, requireAuth }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json(service.getHealth());
  });

  router.get('/ready', (req, res) => {
    const result = service.getReadiness();
    res.status(result.statusCode).json(result.body);
  });

  router.get('/api/deploy/smoke', (req, res) => {
    const result = service.getDeploymentSmoke();
    res.status(result.statusCode).json(result.body);
  });

  router.get('/metrics', requireAuth, (req, res) => {
    res.json(service.getMetrics());
  });

  return router;
}

module.exports = { createObservabilityRouter };
