const express = require('express');
const { DirectoryValidationError } = require('../services/it-directory-service');

function createItDirectoryRouter({ service, requireAuth, requireAdmin }) {
  const router = express.Router();

  function handleError(error, res, next) {
    if (error instanceof DirectoryValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }

  router.get('/directory', requireAuth, requireAdmin, (req, res, next) => {
    try {
      res.json(service.search({
        base: req.query.base,
        filter: req.query.filter,
        limit: req.query.limit,
      }));
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/directory', requireAuth, requireAdmin, (req, res, next) => {
    try {
      res.status(201).json(service.createObject(req.body, req.session.userId));
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.patch('/directory/:id', requireAuth, requireAdmin, (req, res, next) => {
    try {
      const result = service.updateObject(req.params.id, req.body, req.session.userId);
      if (!result) return res.status(404).json({ error: 'Directory object not found' });
      return res.json(result);
    } catch (error) {
      return handleError(error, res, next);
    }
  });

  router.get('/directory/:id/audit', requireAuth, requireAdmin, (req, res, next) => {
    try {
      const object = service.getObject(req.params.id);
      if (!object) return res.status(404).json({ error: 'Directory object not found' });
      return res.json({ audit: service.listAudit(req.params.id) });
    } catch (error) {
      return handleError(error, res, next);
    }
  });

  router.get('/security-guide', requireAuth, requireAdmin, (req, res) => {
    res.json(service.getSecurityGuide());
  });

  return router;
}

module.exports = { createItDirectoryRouter };
