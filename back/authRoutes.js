const express = require('express');
const router = express.Router();
const authController = require('./authController');
const { verifyToken, protect, restrictTo, authenticateToken } = require('./authMiddleware');
const { verifyAvatar } = require('./profileMiddleware');
const dashesController = require('./dashesController');
const adminController = require('./adminController');
const rateLimit = require('./rateLimit');
const bigManagerController = require('./bigManagerController');
const activityAudit = require('./activityAudit');
const loginLimit = rateLimit({ max: 8, keyBy: req => req.body?.identity });
const otpLimit = rateLimit({ max: 8, keyBy: req => req.body?.userId || req.body?.preAuthToken });
const recoveryLimit = rateLimit({ max: 4, keyBy: req => req.body?.email || req.body?.userId });
const registrationLimit = rateLimit({ max: 25 });

// ============================================================================
// 1. ROUTES PUBLIQUES (Non protégées)
// ============================================================================

// Authentification de base & 2FA
router.post('/register', registrationLimit, authController.register);
router.get('/registration-status', authController.registrationStatus);
router.get('/registration-options', authController.registrationOptions);
router.post('/login', loginLimit, authController.login);
router.post('/verify-2fa', otpLimit, authController.verify2FA);
router.post('/resend-2fa', otpLimit, authController.resend2FA);
router.post('/validate-2FA', otpLimit, authController.validate2FA);
router.post('/2fa/validate', otpLimit, authController.validate2FA);

// Mot de passe oublié & Récupération OTP
router.post('/forgot-password', recoveryLimit, authController.forgotPassword);
router.post('/reset-password', recoveryLimit, authController.resetPassword);
router.post('/reset-otp', recoveryLimit, authController.resetOTP);
router.post('/verify-otp', otpLimit, authController.verifyOTP);


// ============================================================================
// 2. ROUTES PROTÉGÉES (Nécessitent un JWT valide)
// ============================================================================

// Configuration 2FA (nécessite d'être déjà authentifié)
router.post('/2fa/setup', protect, authController.setup2FA);
router.post('/2fa/enable', protect, authController.verifyAndEnable2FA);

// Rapports & Soumissions Agent
router.get('/reports', protect, dashesController.getDashboardData);
router.post('/reports-store', protect, dashesController.storeReport);
router.post('/report-issues', protect, restrictTo('agent'), dashesController.storeReportIssue);
router.get('/agent/my-proposals', protect, restrictTo('agent'), dashesController.getMyReportIssues);
router.get('/agent/activities', protect, restrictTo('agent'), dashesController.getAgentActivitiesForProposal);
router.get('/agent/my-evaluations', protect, restrictTo('agent'), dashesController.getMyAgentEvaluations);
router.get('/agent-stats', protect, dashesController.getAgentStats);
router.post('/save-task', protect, dashesController.saveTask);

// Gestion du Profil & Mot de passe
router.get('/getprofile', protect, dashesController.getProfile);
router.get('/activity-history', protect, activityAudit.getOwnHistory);
router.put('/profile', protect, dashesController.updateProfile);
router.put('/change-password', protect, dashesController.changePassword);

// Gestion des Avatars
router.post('/charge-avatar', protect, verifyAvatar, dashesController.chargeAvatar);
router.get('/get-avatar', protect, dashesController.loadAvatar);

// Données Visualisation / Métriques Agent & Utilisateur
router.get('/dashboard-stats', protect, dashesController.get_dashboard_stats);
router.get('/hourly-chart-data', protect, dashesController.get_hourly_chart_data);
router.get('/report-status', protect, dashesController.get_report_status);
router.get('/timeline-activities', protect, dashesController.get_timeline_activities);
router.get('/objectives', protect, dashesController.get_objectives);
router.get('/professional-summary', protect, dashesController.get_professional_summary);
router.get('/detailed-history', protect, dashesController.get_detailed_history);


// ============================================================================
// 3. ROUTES RESTREINTES (Réservées aux Chefs de Service)
// ============================================================================

// Administration — chaque route vérifie le rôle côté serveur.
router.get('/admin/overview', protect, adminController.requireActiveAdmin, adminController.getOverview);
router.get('/admin/registration', protect, adminController.requireActiveAdmin, adminController.getRegistrationSetting);
router.put('/admin/registration', protect, adminController.requireActiveAdmin, adminController.setRegistrationSetting);
router.get('/admin/users', protect, adminController.requireActiveAdmin, adminController.listUsers);
router.post('/admin/users', protect, adminController.requireActiveAdmin, adminController.createUser);
router.put('/admin/users/:userId', protect, adminController.requireActiveAdmin, adminController.updateUser);
router.patch('/admin/users/:userId/status', protect, adminController.requireActiveAdmin, adminController.setUserStatus);
router.post('/admin/users/:userId/reset-password', protect, adminController.requireActiveAdmin, adminController.resetUserPassword);
router.get('/admin/departments', protect, adminController.requireActiveAdmin, adminController.listDepartments);
router.post('/admin/departments', protect, adminController.requireActiveAdmin, adminController.createDepartment);
router.put('/admin/departments/:departmentId', protect, adminController.requireActiveAdmin, adminController.updateDepartment);
router.delete('/admin/departments/:departmentId', protect, adminController.requireActiveAdmin, adminController.deleteDepartment);
router.get('/admin/reports', protect, adminController.requireActiveAdmin, adminController.listReports);
router.get('/admin/reviews', protect, adminController.requireActiveAdmin, adminController.listReviews);
router.get('/admin/audit-logs', protect, adminController.requireActiveAdmin, adminController.listAuditLogs);
router.get('/admin/retention', protect, adminController.requireActiveAdmin, adminController.getRetentionSettings);
router.put('/admin/retention', protect, adminController.requireActiveAdmin, adminController.saveRetentionSettings);
router.post('/admin/archives/run', protect, adminController.requireActiveAdmin, adminController.runArchive);
router.get('/admin/archives', protect, adminController.requireActiveAdmin, adminController.listArchives);
router.get('/admin/archives/:archiveId', protect, adminController.requireActiveAdmin, adminController.getArchiveDetails);

router.get(
  '/chef-dashboard',
  protect,                          // 1. Vérifie la présence et validité du Token JWT
  restrictTo('chef_service'),       // 2. Bloque si le rôle n'est pas 'chef_service' (403)
  dashesController.getChefServiceDashboard
);
router.get('/chef-dashboard/synthesis', protect, restrictTo('chef_service'), dashesController.getChefServiceSynthesis);
router.get(
  '/chef-dashboard/agents/:agentId',
  protect,
  restrictTo('chef_service'),
  dashesController.getChefServiceAgentDetails
);
router.get('/chef-dashboard/evaluations', protect, restrictTo('chef_service'), dashesController.getChefServiceEvaluations);
router.get('/chef-dashboard/rankings', protect, restrictTo('chef_service'), dashesController.getChefServiceAgentRankings);
router.get('/chef-dashboard/proposals', protect, restrictTo('chef_service'), dashesController.getChefServiceReportIssues);
router.patch('/chef-dashboard/proposals/:issueId/decision', protect, restrictTo('chef_service'), dashesController.decideChefServiceReportIssue);
router.post('/chef-dashboard/agents/:agentId/evaluations', protect, restrictTo('chef_service'), dashesController.saveChefServiceAgentEvaluation);
router.get('/chef-dashboard/activities', protect, restrictTo('chef_service'), dashesController.getChefServiceActivities);
router.get('/agent/department-chefs', protect, restrictTo('agent'), dashesController.getAgentDepartmentChefs);
router.get('/department/colleagues', protect, dashesController.getDepartmentColleagues);
router.get('/chef-dashboard/activities/:activityId', protect, restrictTo('chef_service'), dashesController.getChefServiceActivityDetails);
router.patch('/chef-dashboard/activities/:activityId/status', protect, restrictTo('chef_service'), dashesController.updateChefServiceActivityStatus);
router.patch('/chef-dashboard/activities/:activityId/decision', protect, restrictTo('chef_service'), dashesController.decideChefServiceActivity);

router.get('/big-manager/overview', protect, restrictTo('big_manager'), bigManagerController.getOverview);
router.get('/big-manager/agents/:agentId', protect, restrictTo('big_manager'), bigManagerController.getAgentDetails);
router.post('/big-manager/ratings', protect, restrictTo('big_manager'), bigManagerController.rateManager);
router.post('/big-manager/reviews', protect, restrictTo('big_manager'), bigManagerController.addReview);

module.exports = router;
