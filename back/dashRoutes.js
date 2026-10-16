const express = require('express');
const router = express.Router();

// Importation du contrôleur JavaScript
const dashesController = require('./dashesController');
const { protect } = require('./authMiddleware');

// Route GET : /api/reports
router.get('/reports', protect, dashesController.getDashboardData);

// Route POST : /api/reports/store
router.post('/reports-store', protect, dashesController.storeReport);

router.post('/agent-stats', protect, dashesController.getAgentStats);

module.exports = router;
