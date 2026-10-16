const express = require('express');
const router = express.Router();

// Importation du contrôleur JavaScript
const dashesController = require('./dashesController');
const { protect, restrictTo } = require('./authMiddleware');

// Route GET : /api/reports
router.get('/reports', protect, restrictTo('agent'), dashesController.getDashboardData);

// Route POST : /api/reports/store
router.post('/reports-store', protect, restrictTo('agent'), dashesController.storeReport);

router.post('/agent-stats', protect, restrictTo('agent'), dashesController.getAgentStats);

module.exports = router;
