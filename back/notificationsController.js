// back/notificationsController.js
// Notifications in-app (cloche + panneau) : création, lecture et marquage comme lu.
// Ce module est volontairement isolé pour ne rien modifier au flux métier existant.
const db = require('./db');

const MAX_TITLE = 255;
const MAX_BODY = 1000;
const MAX_TYPE = 50;
const MAX_LINK = 500;
const LIST_LIMIT = 50;

function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('fr-FR');
}

/**
 * Crée une notification pour un utilisateur.
 * Ne lève jamais d'erreur : une notification ne doit pas casser le flux appelant.
 * @returns {Promise<boolean>} true si la notification a été enregistrée.
 */
async function createNotification(userId, { title, body = '', type = 'info', link = null } = {}) {
  const id = String(userId == null ? '' : userId).trim();
  const safeTitle = String(title || '').trim().slice(0, MAX_TITLE);
  if (!id || id.length > 36 || !safeTitle) return false;
  try {
    await db.execute(
      'INSERT INTO notifications (user_id, title, body, type, link) VALUES (?, ?, ?, ?, ?)',
      [
        id,
        safeTitle,
        String(body || '').slice(0, MAX_BODY),
        String(type || 'info').slice(0, MAX_TYPE),
        link ? String(link).slice(0, MAX_LINK) : null,
      ],
    );
    return true;
  } catch (error) {
    console.error('createNotification:', error.message);
    return false;
  }
}

// GET /api/auth/notifications
async function listNotifications(req, res) {
  try {
    const [rows] = await db.query(
      `SELECT id, title, body, type, link, is_read, created_at
         FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ${LIST_LIMIT}`,
      [req.user.id],
    );
    const [countRows] = await db.query(
      'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.user.id],
    );
    const unreadCount = countRows.length ? Number(countRows[0].unread) || 0 : 0;
    return res.json({ success: true, notifications: rows, unreadCount });
  } catch (error) {
    console.error('listNotifications:', error.message);
    return res.status(500).json({ success: false, message: 'Impossible de charger les notifications.' });
  }
}

// PATCH /api/auth/notifications/read-all
async function markAllNotificationsRead(req, res) {
  try {
    await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
    return res.json({ success: true });
  } catch (error) {
    console.error('markAllNotificationsRead:', error.message);
    return res.status(500).json({ success: false, message: 'Impossible de mettre à jour les notifications.' });
  }
}

// PATCH /api/auth/notifications/:id/read
async function markNotificationRead(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ success: false, message: 'Identifiant de notification invalide.' });
  }
  try {
    await db.execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.user.id]);
    return res.json({ success: true });
  } catch (error) {
    console.error('markNotificationRead:', error.message);
    return res.status(500).json({ success: false, message: 'Impossible de mettre à jour la notification.' });
  }
}

/**
 * Notifie l'agent qu'un de ses rapports a été approuvé ou rejeté.
 * @param {number|string} activityId identifiant de l'activité décidée.
 * @param {string} decision 'approved' | 'rejected'.
 * @param {string} reason motif éventuel (obligatoire en cas de rejet).
 */
async function notifyReportDecision(activityId, decision, reason) {
  const id = Number.parseInt(activityId, 10);
  if (!Number.isSafeInteger(id) || id < 1) return;
  try {
    const [rows] = await db.query(
      `SELECT dr.user_id, dr.report_date
         FROM daily_reports dr
         JOIN report_activities ra ON ra.daily_report_id = dr.id
        WHERE ra.id = ? AND LOWER(TRIM(ra.status)) <> 'superseded'
        LIMIT 1`,
      [id],
    );
    if (!rows.length) return;
    const normalizedDecision = String(decision).toLowerCase();
    const approved = normalizedDecision === 'approved';
    const correction = normalizedDecision === 'request_changes';
    const day = formatDate(rows[0].report_date);
    await createNotification(rows[0].user_id, {
      title: approved ? 'Rapport approuvé' : correction ? 'Correction demandée' : 'Rapport rejeté',
      body: approved
        ? `Votre rapport du ${day} a été approuvé.`
        : correction ? `Votre rapport du ${day} doit être corrigé : ${String(reason || '').slice(0, 300)}` : `Votre rapport du ${day} a été rejeté : ${String(reason || '').slice(0, 300)}`,
      type: approved ? 'report_approved' : correction ? 'report_correction_requested' : 'report_rejected',
      link: '/html/Stat_dashb.html',
    });
  } catch (error) {
    console.error('notifyReportDecision:', error.message);
  }
}

/**
 * Notifie l'agent qu'une de ses propositions a été traitée par son chef de service.
 */
async function notifyIssueDecision(issueId, decision, reviewComment) {
  const id = Number.parseInt(issueId, 10);
  if (!Number.isSafeInteger(id) || id < 1) return;
  try {
    const [rows] = await db.query(
      `SELECT dr.user_id
         FROM report_issues ri
         JOIN daily_reports dr ON dr.id = ri.report_id
        WHERE ri.id = ?
        LIMIT 1`,
      [id],
    );
    if (!rows.length) return;
    const approved = String(decision).toLowerCase() === 'approved';
    const comment = String(reviewComment || '').slice(0, 300);
    await createNotification(rows[0].user_id, {
      title: approved ? 'Proposition approuvée' : 'Proposition rejetée',
      body: approved ? 'Votre proposition a été approuvée.' : `Votre proposition a été rejetée${comment ? ` : ${comment}` : '.'}`,
      type: approved ? 'issue_approved' : 'issue_rejected',
      link: '/html/Stat_dashb.html',
    });
  } catch (error) {
    console.error('notifyIssueDecision:', error.message);
  }
}

module.exports = {
  createNotification,
  notifyReportDecision,
  notifyIssueDecision,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
};
