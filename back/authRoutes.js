const express = require('express');
const router = express.Router();
const authController = require('./authController');
const { verifyToken, protect, restrictTo, authenticateToken } = require('./authMiddleware');
const { verifyAvatar } = require('./profileMiddleware');
const dashesController = require('./dashesController');
const adminController = require('./adminController');
const rateLimit = require('./rateLimit');
const bigManagerController = require('./bigManagerController');
const notificationsController = require('./notificationsController');
const activityAudit = require('./activityAudit');
const advancedFeaturesController = require('./advancedFeaturesController');
const monthlySummaryService = require('./monthlySummaryService');
const loginLimit = rateLimit({ max: 8, scope: 'login', keyBy: req => req.body?.identity });
const otpLimit = rateLimit({ max: 8, scope: 'otp', keyBy: req => req.body?.preAuthToken || req.body?.userId || req.body?.email });
const recoveryLimit = rateLimit({ max: 4, scope: 'password-recovery', keyBy: req => req.body?.email || req.body?.userId });
const registrationLimit = rateLimit({ max: 25 });
const publicConfigLimit = rateLimit({ max: 120 });
const externalApiLimit = rateLimit({ max: 60, scope: 'external-api', keyBy: req => req.get('x-api-token') });

// ============================================================================
// 1. ROUTES PUBLIQUES (Non protégées)
// ============================================================================

// Authentification de base & 2FA
router.post('/register', registrationLimit, authController.register);
router.get('/registration-status', publicConfigLimit, authController.registrationStatus);
router.get('/registration-options', publicConfigLimit, authController.registrationOptions);
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
router.post('/logout', protect, authController.logout);


// ============================================================================
// 2. ROUTES PROTÉGÉES (Nécessitent un JWT valide)
// ============================================================================

// Configuration 2FA (nécessite d'être déjà authentifié)
router.post('/2fa/setup', protect, authController.setup2FA);
router.post('/2fa/enable', protect, authController.verifyAndEnable2FA);

// Rapports & Soumissions Agent
router.get('/reports', protect, restrictTo('agent'), dashesController.getDashboardData);
router.get('/reports/latest-activities', protect, restrictTo('agent'), dashesController.getLatestReportActivities);
router.get('/agent/reminder-status', protect, restrictTo('agent'), dashesController.getAgentReminderStatus);
router.post('/reports-store', protect, restrictTo('agent'), dashesController.storeReport);
router.get('/agent/reports/:reportId/correction', protect, restrictTo('agent'), dashesController.getReportForCorrection);
router.put('/agent/reports/:reportId/correction', protect, restrictTo('agent'), dashesController.resubmitCorrectedReport);
router.post('/report-issues', protect, restrictTo('agent'), dashesController.storeReportIssue);
router.get('/agent/my-proposals', protect, restrictTo('agent'), dashesController.getMyReportIssues);
router.get('/agent/activities', protect, restrictTo('agent'), dashesController.getAgentActivitiesForProposal);
router.get('/agent/assigned-issues', protect, restrictTo('agent'), dashesController.getMyAssignedIssues);
router.patch('/agent/assigned-issues/:issueId', protect, restrictTo('agent'), dashesController.updateMyAssignedIssue);
router.get('/agent/my-evaluations', protect, restrictTo('agent'), dashesController.getMyAgentEvaluations);
router.get('/agent-stats', protect, restrictTo('agent'), dashesController.getAgentStats);
router.post('/save-task', protect, restrictTo('agent'), dashesController.saveTask);

// Notifications in-app (cloche + panneau) — accessibles à tous les rôles authentifiés.
router.get('/notifications', protect, notificationsController.listNotifications);
router.patch('/notifications/read-all', protect, notificationsController.markAllNotificationsRead);
router.patch('/notifications/:id/read', protect, notificationsController.markNotificationRead);

// Gestion du Profil & Mot de passe
router.get('/getprofile', protect, dashesController.getProfile);
router.get('/activity-history', protect, activityAudit.getOwnHistory);
router.get('/privacy/export', protect, activityAudit.exportOwnData);
router.put('/profile', protect, dashesController.updateProfile);
router.put('/change-password', protect, dashesController.changePassword);
router.get('/my/objectives', protect, advancedFeaturesController.getMyObjectives);
router.get('/my/api-tokens', protect, advancedFeaturesController.getMyApiTokens);
router.post('/my/api-tokens', protect, advancedFeaturesController.createApiToken);
router.delete('/my/api-tokens/:id', protect, advancedFeaturesController.revokeApiToken);
router.get('/my/webhooks', protect, advancedFeaturesController.listWebhooks);
router.post('/my/webhooks', protect, advancedFeaturesController.createWebhook);
router.delete('/my/webhooks/:id', protect, advancedFeaturesController.revokeWebhook);
router.post('/push/subscribe', protect, advancedFeaturesController.savePushSubscription);
router.post('/push/unsubscribe', protect, advancedFeaturesController.deletePushSubscription);
router.get('/push/config', protect, advancedFeaturesController.getPushConfig);
router.get('/big-manager/analytics', protect, restrictTo('big_manager'), advancedFeaturesController.getDepartmentAnalytics);
router.get('/delegations', protect, advancedFeaturesController.getDelegations);
router.post('/delegations', protect, restrictTo('admin','big_manager','chef_service'), advancedFeaturesController.createDelegation);
router.delete('/delegations/:id', protect, restrictTo('admin','big_manager','chef_service'), advancedFeaturesController.revokeDelegation);
router.post('/big-manager/objectives', protect, restrictTo('admin','big_manager','chef_service'), advancedFeaturesController.setObjective);
router.get('/big-manager/objectives', protect, restrictTo('admin','big_manager','chef_service'), advancedFeaturesController.listDepartmentObjectives);
router.get('/admin/module-permissions', protect, adminController.requireActiveAdmin, advancedFeaturesController.getModulePermissions);
router.put('/admin/module-permissions', protect, adminController.requireActiveAdmin, advancedFeaturesController.setModulePermission);
router.get('/external/reports', externalApiLimit, advancedFeaturesController.externalReports);
router.post('/admin/monthly-summary/run', protect, adminController.requireActiveAdmin, async (_req,res,next)=>{
  try { const result=await monthlySummaryService.sendMonthlySummary(new Date(new Date().getFullYear(),new Date().getMonth(),1,Number(process.env.MONTHLY_SUMMARY_HOUR||8))); return res.json({success:true,...result}); }
  catch(error){next(error);}
});

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
router.get('/admin/sessions', protect, adminController.requireActiveAdmin, adminController.listSessions);
router.patch('/admin/sessions/:sessionId/revoke', protect, adminController.requireActiveAdmin, adminController.revokeSession);
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
router.patch('/chef-dashboard/proposals/:issueId/assignment', protect, restrictTo('chef_service'), dashesController.assignChefServiceIssue);
router.patch('/chef-dashboard/proposals/:issueId/decision', protect, restrictTo('chef_service'), dashesController.decideChefServiceReportIssue);
router.post('/chef-dashboard/agents/:agentId/evaluations', protect, restrictTo('chef_service'), dashesController.saveChefServiceAgentEvaluation);
router.get('/chef-dashboard/activities', protect, restrictTo('chef_service'), dashesController.getChefServiceActivities);
router.post('/chef-dashboard/activities/bulk-approve', protect, restrictTo('chef_service'), dashesController.bulkApproveChefServiceReports);
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
