/**
 * Tableau de bord - Chef de service
 * API attendue : GET /api/auth/chef-dashboard?period=month|quarter|year
 */
(() => {
  // authRoutes est monté sous /api/auth dans back/server.js.
  const API_URL = '/api/auth/chef-dashboard';
  let dashboardData = null;
  let lastFocusedElement = null;
  let activityPage = 1;
  let activitySearchTimer = null;
  let proposalSearchTimer = null;
  let rankingSearchTimer = null;
  let approvalQueueOnly = false;

  // --- Utilitaires ---
  const $ = (id) => document.getElementById(id);

  const text = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value ?? '—';
  };

  const initials = (name = '') => {
    return (
      name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] || '')
        .join('')
        .toUpperCase() || 'CS'
    );
  };

  const formatDate = (value) => {
    if (!value) return '—';
    // Les colonnes SQL DATE arrivent au format YYYY-MM-DD. Les interpréter
    // avec new Date() les traite comme minuit UTC et peut afficher la veille
    // dans un navigateur configuré sur un fuseau horaire négatif.
    const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12)
      : new Date(value);
    return Number.isNaN(d.getTime())
      ? String(value)
      : new Intl.DateTimeFormat('fr-FR', {
          day: '2-digit',
          month: 'short',
        }).format(d);
  };

  const escapeHtml = (value = '') => {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&#34;',
          "'": '&#39;',
        })[c]
    );
  };

  const formatPerson = (p) => {
    if (typeof p === 'string') return p;
    return (
      p?.name ||
      p?.fullName ||
      [p?.firstName, p?.lastName].filter(Boolean).join(' ') ||
      'Agent'
    );
  };

  // --- Helper JWT Headers ---
  function getAuthHeaders() {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  // --- Gestion fluide des erreurs d'authentification ---
  function handleAuthError(status) {
    if (status === 401) {
      text('updatedLabel', 'Session expirée');
      const reportsBody = $('reportsBody');
      if (reportsBody) {
        reportsBody.innerHTML = `
          <tr>
            <td colspan="6" class="empty">
              Session expirée. Redirection vers la page d'accueil...
            </td>
          </tr>
        `;
      }
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1000);
      return true;
    }

    if (status === 403) {
      text('updatedLabel', 'Accès non autorisé');
      const reportsBody = $('reportsBody');
      if (reportsBody) {
        reportsBody.innerHTML = `
          <tr>
            <td colspan="6" class="empty">
              Accès refusé : ce tableau de bord est réservé aux Chefs de Service.
            </td>
          </tr>
        `;
      }
      return true;
    }

    return false;
  }

  // --- Rendu des composants UI ---

  function renderActivities(rows = []) {
    const box = $('activitiesList');
    if (!box) return;

    if (!rows.length) {
      box.innerHTML = '<div class="empty">Aucune activité terminée sur cette période.</div>';
      return;
    }

    box.innerHTML = rows
      .map((a) => {
        const progress = Math.max(0, Math.min(100, Number(a.progress ?? a.completionRate ?? 0)));
        const dueDateLabel = a.dueDate ? `Échéance ${formatDate(a.dueDate)}` : (a.status || 'En cours');

        return `
          <div class="activity-item">
            <div class="activity-meta">
              <strong>${escapeHtml(a.title || a.name || 'Activité')}</strong>
              <span>${escapeHtml(dueDateLabel)}</span>
            </div>
            <div class="activity-track">
              <div class="track"><span style="width:${progress}%"></span></div>
              <small>${progress}%</small>
            </div>
          </div>
        `;
      })
      .join('');
  }

  function renderTeam(rows = []) {
    text('teamCount', `${rows.length} agent${rows.length > 1 ? 's' : ''}`);
    const box = $('teamList');
    if (!box) return;

    if (!rows.length) {
      box.innerHTML = '<div class="empty">Aucun agent rattaché à votre service.</div>';
      return;
    }

    box.innerHTML = rows
      .slice(0, 4)
      .map((a) => {
        const name = formatPerson(a);
        return `
          <div class="agent-row agent-row-clickable" role="button" tabindex="0" data-agent-id="${escapeHtml(a.id)}" aria-label="Voir le profil de ${escapeHtml(name)}">
            <span class="person-avatar">${escapeHtml(initials(name))}</span>
            <span class="agent-info">
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(a.position || a.role || 'Agent')}</small>
            </span>
            <span class="agent-count">${Number(a.pendingReports || 0)} en attente</span>
          </div>
        `;
      })
      .join('');
  }

  function activityStatusInfo(status) {
    const value = String(status || '').toLowerCase();
    if (['approved', 'validated', 'accepted'].includes(value)) return ['Approuvée', 'activity-completed'];
    if (['rejected', 'refused'].includes(value)) return ['Rejetée', 'activity-blocked'];
    if (['submitted', 'en_attente', 'à_valider', 'a_valider'].includes(value)) return ['À approuver', 'activity-pending'];
    if (['completed', 'complete', 'done', 'terminee', 'terminée', 'réalisée', 'realisee'].includes(value)) return ['Terminée', 'activity-completed'];
    if (['in_progress', 'in progress', 'en cours'].includes(value)) return ['En cours', 'activity-progress'];
    if (['blocked', 'bloquee', 'bloquée'].includes(value)) return ['Bloquée', 'activity-blocked'];
    return ['En attente', 'activity-pending'];
  }

  async function loadActivities() {
    const body = $('activityTableBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="empty">Chargement des activités…</td></tr>';
    const params = new URLSearchParams({ page: String(activityPage), limit: '10' });
    const search = $('activitySearch')?.value.trim();
    const status = approvalQueueOnly ? 'approval_pending' : $('activityStatusFilter')?.value;
    const category = $('activityCategoryFilter')?.value;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    try {
      const response = await fetch(`${API_URL}/activities?${params}`, { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) {
        if (handleAuthError(response.status)) return;
        throw new Error(data.message || `Erreur HTTP ${response.status}`);
      }
      const pendingCount = Number(data.pendingApprovals || 0);
      const notificationCount = $('approvalNotificationCount');
      if (notificationCount) {
        notificationCount.textContent = pendingCount > 99 ? '99+' : String(pendingCount);
        notificationCount.hidden = pendingCount < 1;
        $('approvalNotifications')?.setAttribute('aria-label', `${pendingCount} rapport${pendingCount === 1 ? '' : 's'} à approuver`);
      }
      renderActivityTable(data);
    } catch (error) {
      body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)} <button type="button" class="text-link link-button" id="retryActivities">Réessayer</button></td></tr>`;
      $('retryActivities')?.addEventListener('click', loadActivities);
    }
  }

  async function loadDepartmentProposals() {
    const body = $('proposalTableBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="empty">Chargement des propositions…</td></tr>';
    const params = new URLSearchParams();
    const search = $('proposalSearch')?.value.trim();
    const status = $('proposalStatusFilter')?.value;
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    try {
      const response = await fetch(`${API_URL}/proposals?${params}`, { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) {
        if (handleAuthError(response.status)) return;
        throw new Error(data.message || `Erreur HTTP ${response.status}`);
      }
      const proposals = data.proposals || [];
      text('proposalCount', `${proposals.length} proposition${proposals.length === 1 ? '' : 's'}`);
      if (!proposals.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">Aucune proposition ne correspond aux filtres.</td></tr>';
        return;
      }
      body.innerHTML = proposals.map(item => {
        const state = String(item.status || 'Pending').toLowerCase();
        const label = state === 'approved' ? 'Approuvée' : state === 'rejected' ? 'Rejetée' : 'En attente';
        const badge = state === 'approved' ? 'approved' : state === 'rejected' ? 'rejected' : 'pending';
        const actions = state === 'pending'
          ? `<button type="button" class="button button-primary proposal-decision" data-proposal-id="${escapeHtml(item.id)}" data-decision="approved">Approuver</button>
             <button type="button" class="button proposal-decision proposal-reject" data-proposal-id="${escapeHtml(item.id)}" data-decision="rejected">Rejeter</button>`
          : '—';
        return `<tr>
          <td>${escapeHtml(formatDate(item.createdAt || item.reportDate))}</td>
          <td><strong>${escapeHtml(item.agentName || item.username || 'Agent')}</strong><small style="display:block;color:#8994a8">${escapeHtml(item.username || '')}</small></td>
          <td>${escapeHtml(item.activityDescription || 'Activité')}</td>
          <td>${escapeHtml(item.description || '')}</td>
          <td>${escapeHtml(item.proposedSolution || '—')}</td>
          <td><span class="status ${badge}">${label}</span>${item.reviewComment ? `<small style="display:block;margin-top:6px;color:#718096">${escapeHtml(item.reviewComment)}</small>` : ''}</td>
          <td><div class="proposal-actions">${actions}</div></td>
        </tr>`;
      }).join('');
    } catch (error) {
      body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)} <button type="button" class="text-link link-button" id="retryProposals">Réessayer</button></td></tr>`;
      $('retryProposals')?.addEventListener('click', loadDepartmentProposals);
    }
  }

  async function decideProposal(issueId, decision) {
    const reviewComment = decision === 'rejected'
      ? window.prompt('Votre avis est obligatoire pour rejeter cette proposition :')
      : '';
    if (decision === 'rejected' && !reviewComment?.trim()) {
      if (reviewComment !== null) window.alert('Veuillez saisir un avis pour rejeter cette proposition.');
      return;
    }
    try {
      const response = await fetch(`${API_URL}/proposals/${encodeURIComponent(issueId)}/decision`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision, review_comment: reviewComment.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Erreur HTTP ${response.status}`);
      await loadDepartmentProposals();
      window.alert(decision === 'approved' ? 'Proposition approuvée.' : 'Proposition rejetée avec votre avis.');
    } catch (error) {
      window.alert(error.message || 'Impossible de traiter la proposition.');
    }
  }

  let notationSearchTimer = null;
  async function loadDepartmentEvaluations() {
    const body = $('notationTableBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="5" class="empty">Chargement des notations…</td></tr>';
    const params = new URLSearchParams();
    const filters = {
      search: $('notationSearch')?.value.trim(),
      rating: $('notationRating')?.value,
      dateFrom: $('notationDateFrom')?.value,
      dateTo: $('notationDateTo')?.value,
    };
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const response = await fetch(`${API_URL}/evaluations?${params}`, { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) {
        if (handleAuthError(response.status)) return;
        throw new Error(data.message || `Erreur HTTP ${response.status}`);
      }
      const evaluations = data.evaluations || [];
      text('notationSummary', `${data.count || 0} avis · moyenne ${Number(data.average || 0).toFixed(1)} / 5`);
      body.innerHTML = evaluations.length ? evaluations.map(item => `
        <tr><td>${escapeHtml(formatDate(item.evaluationDate))}</td>
        <td><strong>${escapeHtml(item.agentName || item.agentUsername || 'Agent')}</strong><small style="display:block;color:#8994a8">${escapeHtml(item.agentUsername || '')}</small></td>
        <td><strong>${Number(item.rating)}/5</strong></td><td>${escapeHtml(item.comment || '')}</td>
        <td>${escapeHtml(item.managerName || 'Chef de service')}</td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">Aucune notation ne correspond à votre recherche.</td></tr>';
    } catch (error) {
      body.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(error.message)} <button type="button" class="text-link link-button" id="retryNotations">Réessayer</button></td></tr>`;
      $('retryNotations')?.addEventListener('click', loadDepartmentEvaluations);
    }
  }

  async function loadAgentRankings() {
    const body = $('rankingTableBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="empty">Calcul du classement à partir des données enregistrées…</td></tr>';
    const params = new URLSearchParams({ sort: $('rankingSort')?.value || 'performance' });
    const filters = {
      search: $('rankingSearch')?.value.trim(),
      dateFrom: $('rankingDateFrom')?.value,
      dateTo: $('rankingDateTo')?.value,
    };
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    try {
      const response = await fetch(`${API_URL}/rankings?${params}`, { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) {
        if (handleAuthError(response.status)) return;
        throw new Error(data.message || `Erreur HTTP ${response.status}`);
      }
      const rows = data.rankings || [];
      text('rankingCount', `${rows.length} agent${rows.length === 1 ? '' : 's'}`);
      body.innerHTML = rows.length ? rows.map(agent => `
        <tr>
          <td><span class="ranking-position ${agent.rank <= 3 ? `ranking-position-top ranking-position-${agent.rank}` : ''}">#${Number(agent.rank)}</span></td>
          <td><span class="activity-agent"><span class="person-avatar">${escapeHtml(initials(agent.agentName || agent.username))}</span><span><strong>${escapeHtml(agent.agentName || agent.username || 'Agent')}</strong><small>${escapeHtml(agent.username || '')}</small></span></span></td>
          <td><strong>${Number(agent.completedActivities)} / ${Number(agent.activityCount)}</strong></td>
          <td><span class="ranking-rate"><span><i style="width:${Math.max(0, Math.min(100, Number(agent.completionRate)))}%"></i></span><b>${Number(agent.completionRate).toFixed(1)} %</b></span></td>
          <td>${Number(agent.activityHours).toFixed(1)} h</td>
          <td><strong>${Number(agent.averageRating).toFixed(1)} / 5</strong><small style="display:block;color:#8994a8">${Number(agent.ratingCount)} notation${Number(agent.ratingCount) === 1 ? '' : 's'}</small></td>
          <td><strong>${Number(agent.proposalCount)}</strong></td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty">Aucun agent ne correspond aux filtres sélectionnés.</td></tr>';
    } catch (error) {
      body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)} <button type="button" class="text-link link-button" id="retryRankings">Réessayer</button></td></tr>`;
      $('retryRankings')?.addEventListener('click', loadAgentRankings);
    }
  }

  function renderActivityTable(data) {
    const rows = data.activities || [];
    const pagination = data.pagination || { page: 1, total: rows.length, totalPages: 1 };
    const body = $('activityTableBody');
    if (!body) return;
    text('activityTotal', `${pagination.total} activité${pagination.total === 1 ? '' : 's'}`);
    text('activityPageLabel', pagination.total ? `Affichage de ${(pagination.page - 1) * pagination.limit + 1} à ${Math.min(pagination.page * pagination.limit, pagination.total)} sur ${pagination.total}` : 'Aucune activité');
    text('activityPageNumber', `${pagination.page} / ${pagination.totalPages}`);
    $('activityPrev').disabled = pagination.page <= 1;
    $('activityNext').disabled = pagination.page >= pagination.totalPages;
    const categorySelect = $('activityCategoryFilter');
    const selectedCategory = categorySelect.value;
    const categories = data.categories || [];
    categorySelect.innerHTML = '<option value="">Toutes les catégories</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    if (categories.includes(selectedCategory)) categorySelect.value = selectedCategory;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Aucune activité ne correspond aux filtres sélectionnés.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(activity => {
      // Cette colonne suit l'état de l'activité (Completed/Pending).
      // L'approbation concerne le rapport parent et reste visible dans le détail.
      const status = activityStatusInfo(activity.status);
      const agent = activity.agentName || activity.username || 'Agent';
      return `<tr class="activity-row" data-activity-id="${Number(activity.id)}" tabindex="0" role="button" aria-label="Voir le détail de ${escapeHtml(activity.description)}">
        <td>${escapeHtml(formatDate(activity.reportDate))}</td>
        <td><span class="activity-agent"><span class="person-avatar">${escapeHtml(initials(agent))}</span><span><strong>${escapeHtml(agent)}</strong><small>${escapeHtml(activity.jobTitle || 'Agent')}</small></span></span></td>
        <td><span class="activity-description">${escapeHtml(activity.description)}</span><small class="report-ref">Rapport ${escapeHtml(String(activity.reportId || '').slice(0, 8))}</small></td>
        <td>${escapeHtml(activity.category)}</td><td>${Number(activity.hours).toFixed(1)} h</td>
        <td><span class="activity-status ${status[1]}">${status[0]}</span></td>
        <td><button type="button" class="row-action activity-view-button" data-activity-id="${Number(activity.id)}" aria-label="Voir le détail"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></td>
      </tr>`;
    }).join('');
  }

  async function showActivityDetails(activityId) {
    const modal = $('activityModal');
    const content = $('activityModalContent');
    if (!modal || !content) return;
    lastFocusedElement = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    content.innerHTML = '<div class="empty team-modal-empty">Chargement du détail…</div>';
    $('closeActivityModal')?.focus();
    try {
      const response = await fetch(`${API_URL}/activities/${encodeURIComponent(activityId)}`, { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Erreur HTTP ${response.status}`);
      const a = data.activity || {};
      const activityState = activityStatusInfo(a.status);
      const reportState = String(a.reportStatus || '').toLowerCase();
      const status = reportState === 'submitted' ? ['Rapport à approuver', 'activity-pending']
        : reportState === 'approved' ? ['Rapport approuvé', 'activity-completed']
        : reportState === 'rejected' ? ['Rapport rejeté', 'activity-blocked']
        : activityState;
      content.innerHTML = `<form class="activity-detail-form">
        <div class="detail-form-top"><span class="activity-status ${status[1]}">${status[0]}</span><span>Rapport ${escapeHtml(String(a.reportId || '').slice(0, 8))} · ${escapeHtml(formatDate(a.reportDate))}</span></div>
        <div class="detail-form-grid">
          <label>Agent<input readonly value="${escapeHtml(a.agentName || a.username || 'Agent')}"></label>
          <label>Fonction<input readonly value="${escapeHtml(a.jobTitle || 'Agent')}"></label>
          <label>Catégorie<input readonly value="${escapeHtml(a.category || '')}"></label>
          <label>Durée déclarée<input readonly value="${Number(a.hours).toFixed(1)} heure(s)"></label>
        </div>
        <label>Statut de l’activité<input readonly value="${escapeHtml(activityState[0])}"></label>
        <div class="approval-actions"><button type="button" class="button ${String(a.status).toLowerCase() === 'completed' ? 'button-danger' : 'button-primary'}" data-activity-status="${String(a.status).toLowerCase() === 'completed' ? 'Pending' : 'Completed'}" data-activity-id="${Number(a.id)}"><i class="fa-solid ${String(a.status).toLowerCase() === 'completed' ? 'fa-rotate-left' : 'fa-check'}"></i> ${String(a.status).toLowerCase() === 'completed' ? 'Remettre en attente' : 'Marquer comme terminée'}</button></div>
        <label>Description<textarea readonly rows="3">${escapeHtml(a.description || '')}</textarea></label>
        <label>Objectifs<textarea readonly rows="3">${escapeHtml(a.objectives || 'Non renseignés')}</textarea></label>
        <label>Observations<textarea readonly rows="3">${escapeHtml(a.observations || 'Aucune observation')}</textarea></label>
        <label>Commentaires du rapport<textarea readonly rows="2">${escapeHtml(a.reportComments || 'Aucun commentaire')}</textarea></label>
        ${a.reviewComment ? `<label>Motif de rejet<textarea readonly rows="2">${escapeHtml(a.reviewComment)}</textarea></label>` : ''}
        <div class="detail-form-footer"><span>${a.email ? `<i class="fa-regular fa-envelope"></i> ${escapeHtml(a.email)}` : ''}</span><span>Activité enregistrée le ${escapeHtml(formatDate(a.createdAt))}</span></div>
        ${String(a.reportStatus || '').trim().toLowerCase() === 'submitted' ? `<div class="approval-actions"><button type="button" class="button button-danger" data-activity-decision="rejected" data-activity-id="${Number(a.id)}"><i class="fa-solid fa-xmark"></i> Rejeter le rapport</button><button type="button" class="button button-primary" data-activity-decision="approved" data-activity-id="${Number(a.id)}"><i class="fa-solid fa-check"></i> Approuver le rapport</button></div>` : `<p class="approval-status-note">État du rapport : ${escapeHtml(a.reportStatus || 'inconnu')}</p>`}
      </form>`;
    } catch (error) {
      content.innerHTML = `<div class="empty team-modal-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function decideActivity(activityId, decision) {
    const reason = decision === 'rejected' ? window.prompt('Indiquez le motif du rejet :') : '';
    if (decision === 'rejected' && !reason?.trim()) return;
    const buttons = $('activityModalContent')?.querySelectorAll('[data-activity-decision]') || [];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await fetch(`${API_URL}/activities/${encodeURIComponent(activityId)}/decision`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ decision, reason: reason?.trim() || '' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Erreur HTTP ${response.status}`);
      closeActivityModal();
      activityPage = 1;
      await loadActivities();
      await loadDashboard();
      window.alert(data.message || 'Décision enregistrée.');
    } catch (error) {
      window.alert(error.message || 'Impossible d’enregistrer la décision.');
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  async function updateActivityStatus(activityId, status) {
    const buttons = $('activityModalContent')?.querySelectorAll('[data-activity-status]') || [];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await fetch(`${API_URL}/activities/${encodeURIComponent(activityId)}/status`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Erreur HTTP ${response.status}`);
      await Promise.all([loadActivities(), loadDashboard()]);
      await showActivityDetails(activityId);
    } catch (error) {
      window.alert(error.message || 'Impossible de modifier le statut de cette activité.');
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function closeActivityModal() {
    const modal = $('activityModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    lastFocusedElement?.focus?.();
  }

  function openTeamModal() {
    const modal = $('teamModal');
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    renderTeamModalList();
    $('closeTeamModal')?.focus();
  }

  function closeTeamModal() {
    const modal = $('teamModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    lastFocusedElement?.focus?.();
  }

  function renderTeamModalList() {
    const content = $('teamModalContent');
    if (!content) return;
    $('teamBackButton').hidden = true;
    text('teamModalTitle', 'Mon équipe');
    text('teamModalSubtitle', 'Agents de votre département');
    const agents = dashboardData?.team || [];
    if (!agents.length) {
      content.innerHTML = '<div class="empty team-modal-empty">Aucun agent trouvé dans le département associé à votre compte.</div>';
      return;
    }
    content.innerHTML = `<div class="team-directory">${agents.map((agent) => {
      const name = formatPerson(agent);
      const pending = Number(agent.pendingReports || 0);
      return `<button type="button" class="directory-agent" data-agent-id="${escapeHtml(agent.id)}">
        <span class="person-avatar">${escapeHtml(initials(name))}</span>
        <span class="directory-agent-info"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(agent.jobTitle || agent.role || 'Agent')}</small></span>
        <span class="directory-agent-meta">${pending} rapport${pending === 1 ? '' : 's'} à traiter</span>
        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
      </button>`;
    }).join('')}</div>`;
  }

  async function showAgentProfile(agentId) {
    const content = $('teamModalContent');
    if (!content || !agentId) return;
    $('teamBackButton').hidden = false;
    text('teamModalTitle', 'Profil de l’agent');
    text('teamModalSubtitle', 'Profil et statistiques d’activité');
    content.innerHTML = '<div class="empty team-modal-empty">Chargement du profil…</div>';
    try {
      const response = await fetch(`${API_URL}/agents/${encodeURIComponent(agentId)}`, { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `Erreur HTTP ${response.status}`);
      const agent = data.agent || {};
      const stats = data.stats || {};
      const evaluations = data.evaluations || [];
      const evaluationStats = data.evaluationStats || {};
      const name = agent.lastName || agent.username || 'Agent';
      const avatar = typeof agent.avatarUrl === 'string' && agent.avatarUrl.startsWith('/img/')
        ? `<img src="${escapeHtml(agent.avatarUrl)}" alt="">`
        : `<span>${escapeHtml(initials(name))}</span>`;
      const totalActivities = Number(stats.totalActivities || 0);
      const completedActivities = Number(stats.completedActivities || 0);
      const completion = totalActivities ? Math.round(completedActivities / totalActivities * 100) : 0;
      content.innerHTML = `
        <div class="agent-profile">
          <div class="agent-profile-identity"><div class="agent-profile-avatar">${avatar}</div><div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(agent.jobTitle || 'Agent')} · ${escapeHtml(agent.department || '')}</p></div></div>
          <div class="agent-profile-details">
            ${agent.email ? `<a href="mailto:${escapeHtml(agent.email)}"><i class="fa-regular fa-envelope"></i>${escapeHtml(agent.email)}</a>` : ''}
            ${agent.phone ? `<a href="tel:${escapeHtml(agent.phone)}"><i class="fa-solid fa-phone"></i>${escapeHtml(agent.phone)}</a>` : ''}
            ${agent.createdAt ? `<span><i class="fa-regular fa-calendar"></i> Membre depuis le ${escapeHtml(formatDate(agent.createdAt))}</span>` : ''}
          </div>
          ${agent.bio ? `<p class="agent-bio">${escapeHtml(agent.bio)}</p>` : ''}
          <h3 class="agent-stats-title">Statistiques</h3>
          <div class="agent-stats-grid">
            <article><span>Rapports soumis</span><strong>${Number(stats.totalReports || 0)}</strong></article>
            <article><span>Heures déclarées</span><strong>${Number(stats.totalHours || 0).toFixed(1)} h</strong></article>
            <article><span>Activités terminées</span><strong>${completedActivities} / ${totalActivities}</strong><small>${completion}% réalisées</small></article>
            <article><span>Rapports à valider</span><strong>${Number(stats.pendingReports || 0)}</strong></article>
            <article><span>Difficultés signalées</span><strong>${Number(stats.totalIssues || 0)}</strong><small>${Number(stats.needsHelp || 0)} avec demande d’aide</small></article>
            <article><span>Dernier rapport</span><strong class="date-stat">${escapeHtml(stats.lastReportDate || 'Aucun')}</strong></article>
          </div>
          <section class="agent-evaluation-section" style="margin-top:22px;padding-top:18px;border-top:1px solid #edf0f5;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
              <h3 class="agent-stats-title" style="margin:0;">Notes et avis</h3>
              <span style="color:#53627a;font-size:12px;font-weight:700;">${Number(evaluationStats.count || 0) ? Number(evaluationStats.average || 0).toFixed(1) : '—'} / 5 · ${Number(evaluationStats.count || 0)} avis</span>
            </div>
            <form id="agentEvaluationForm" data-agent-id="${escapeHtml(agent.id)}" style="display:grid;gap:10px;padding:14px;background:#f8faff;border:1px solid #e8edf7;border-radius:10px;">
              <label style="display:grid;gap:6px;color:#697589;font-size:11px;font-weight:700;">Note
                <select name="rating" required style="height:38px;border:1px solid #e2e8f0;border-radius:7px;padding:0 10px;background:white;">
                  <option value="">Choisir une note</option><option value="5">5 / 5 — Excellent</option><option value="4">4 / 5 — Très bien</option><option value="3">3 / 5 — Bien</option><option value="2">2 / 5 — À améliorer</option><option value="1">1 / 5 — Insuffisant</option>
                </select>
              </label>
              <label style="display:grid;gap:6px;color:#697589;font-size:11px;font-weight:700;">Avis du chef de service
                <textarea name="comment" required maxlength="5000" rows="3" placeholder="Décrivez les points forts et les axes d’amélioration…" style="border:1px solid #e2e8f0;border-radius:7px;padding:10px;background:white;resize:vertical;font:12px 'DM Sans';"></textarea>
              </label>
              <small style="color:#8993a3;font-size:10px;">Une évaluation par jour et par chef ; une nouvelle saisie le même jour actualise l’avis.</small>
              <button type="submit" class="button button-primary" style="justify-self:start;"><i class="fa-solid fa-star"></i> Enregistrer l’évaluation</button>
            </form>
            <div style="display:grid;gap:9px;margin-top:14px;">
              ${evaluations.length ? evaluations.map(evaluation => `<article style="padding:11px 12px;border:1px solid #edf0f5;border-radius:8px;"><div style="display:flex;justify-content:space-between;gap:10px;color:#7b8798;font-size:10px;"><strong style="color:#41506a;">${escapeHtml(evaluation.managerName || 'Chef de service')} · ${Number(evaluation.rating)}/5</strong><time>${escapeHtml(formatDate(evaluation.evaluationDate))}</time></div><p style="margin:7px 0 0;color:#53627a;font-size:11px;line-height:1.5;">${escapeHtml(evaluation.comment)}</p></article>`).join('') : '<p class="empty">Aucun avis enregistré pour cet agent.</p>'}
            </div>
          </section>
        </div>`;
    } catch (error) {
      content.innerHTML = `<div class="empty team-modal-empty">${escapeHtml(error.message)}<br><button type="button" class="text-link link-button" id="retryAgentProfile">Réessayer</button></div>`;
      $('retryAgentProfile')?.addEventListener('click', () => showAgentProfile(agentId));
    }
  }

  async function submitAgentEvaluation(event) {
    event.preventDefault();
    const form = event.target.closest('#agentEvaluationForm');
    if (!form) return;
    const agentId = form.dataset.agentId;
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    if (submitButton) submitButton.disabled = true;
    try {
      const response = await fetch(`${API_URL}/agents/${encodeURIComponent(agentId)}/evaluations`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ rating: Number(formData.get('rating')), comment: String(formData.get('comment') || '').trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || `Erreur HTTP ${response.status}`);
      await showAgentProfile(agentId);
      window.alert(data.message || 'Évaluation enregistrée.');
    } catch (error) {
      window.alert(error.message || 'Impossible d’enregistrer cette évaluation.');
      if (submitButton) submitButton.disabled = false;
    }
  }

  function render(data) {
    dashboardData = data;
    const s = data.stats || {};
    text('receivedValue', s.reportsReceived ?? 0);
    text('approvedValue', s.approvedReports ?? 0);
    text('pendingReportsValue', s.pendingReports ?? 0);
    text('doneValue', s.activitiesDone ?? 0);
    text('activitiesTotal', `/ ${s.activitiesTotal ?? 0} activités`);

    const calculatedRate = s.activitiesTotal ? (s.activitiesDone / s.activitiesTotal) * 100 : 0;
    const rate = Math.max(0, Math.min(100, Number(s.completionRate ?? calculatedRate)));
    const completionBar = $('completionBar');
    if (completionBar) completionBar.style.width = `${rate}%`;
    text('completionLabel', `${Math.round(rate)} %`);

    const change = Number(s.reportsChangePercent || 0);
    text('receivedTrend', `${change >= 0 ? '↑' : '↓'} ${Math.abs(change)} %`);

    const user = data.user || {};
    const name = user.firstName || (user.name || '').split(' ')[0] || 'Chef de service';
    const avatar = initials(user.name || user.fullName || name);
    text('greetingName', name);
    text('profileName', user.name || user.fullName || 'Chef de service');
    text('profileRole', user.roleLabel || 'Chef de service');
    text('avatarInitials', avatar);
    text('topInitials', avatar);

    renderActivities(data.activities || []);
    renderTeam(data.team || []);
    populateSynthesisAgents(data.team || []);

    const now = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
    text('updatedLabel', `Mis à jour à ${now}`);
  }

  // --- Chargement des données backend ---
  async function loadDashboard() {
    const periodSelect = $('periodSelect');
    const period = periodSelect ? periodSelect.value : 'month';
    text('updatedLabel', 'Chargement des données…');

    try {
      const response = await fetch(`${API_URL}?period=${encodeURIComponent(period)}`, {
        method: 'GET',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        if (handleAuthError(response.status)) return;
        let message = `Erreur HTTP ${response.status} lors du chargement du tableau de bord.`;
        try {
          const errorBody = await response.json();
          if (errorBody.message) message = errorBody.message;
        } catch (_) {
          // Un fallback Express peut répondre en HTML; ne pas faire échouer le parse JSON.
        }
        throw new Error(message);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Le serveur a renvoyé une réponse non JSON. Vérifiez le montage de la route API.');
      }
      const data = await response.json();
      render(data);
    } catch (error) {
      console.error('Erreur de chargement :', error);
      text('updatedLabel', 'Données indisponibles');
      const reportsBody = $('reportsBody');
      if (reportsBody) {
        reportsBody.innerHTML = `
          <tr>
            <td colspan="6" class="empty">
              ${escapeHtml(error.message)} 
              <button class="row-action" id="retryButton">Réessayer</button>
            </td>
          </tr>
        `;
        $('retryButton')?.addEventListener('click', loadDashboard);
      }
    }
  }

  const localIsoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  function updateSynthesisDateRange(period) {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end);
    if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    else if (period === 'month') start.setDate(1);
    else if (period === 'quarter') start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
    else if (period === 'year') start.setMonth(0, 1);
    $('synthesisStartDate').value = localIsoDate(start);
    $('synthesisEndDate').value = localIsoDate(end);
  }

  function populateSynthesisAgents(agents) {
    const select = $('synthesisAgents');
    if (!select) return;
    const selected = new Set(Array.from(select.selectedOptions || []).map(option => option.value));
    select.innerHTML = agents.map(agent => {
      const name = formatPerson(agent);
      const label = `${name}${agent.jobTitle ? ` · ${agent.jobTitle}` : ''}`;
      return `<option value="${escapeHtml(agent.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    Array.from(select.options).forEach(option => { option.selected = selected.has(option.value); });
  }

  async function loadSynthesis() {
    const narrative = $('synthesisNarrative');
    if (!narrative) return;
    narrative.textContent = 'Calcul de la synthèse à partir des données du département…';
    const period = $('synthesisPeriod')?.value || 'month';
    const params = new URLSearchParams({
      period,
      startDate: $('synthesisStartDate')?.value || '',
      endDate: $('synthesisEndDate')?.value || '',
    });
    Array.from($('synthesisAgents')?.selectedOptions || []).forEach(option => params.append('agentIds', option.value));
    try {
      const response = await fetch(`${API_URL}/synthesis?${params}`, { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) {
        if (handleAuthError(response.status)) return;
        throw new Error(data.message || `Erreur HTTP ${response.status}`);
      }
      if (!data.success) throw new Error(data.message || 'Impossible de générer la synthèse.');
      const metrics = data.metrics || {};
      text('synthesisScope', `${data.scope || data.department} · du ${formatDate(data.startDate)} au ${formatDate(data.endDate)}`);
      narrative.textContent = data.narrative || 'Aucune synthèse disponible pour cette période.';
      text('synthesisReports', metrics.reportCount ?? 0);
      text('synthesisCompleted', `${metrics.completedActivities ?? 0} / ${metrics.activitiesTotal ?? 0}`);
      text('synthesisCompletionRate', `${Number(metrics.completionRate || 0).toFixed(1)} % des activités`);
      text('synthesisApproved', `${metrics.approvedReports ?? 0} / ${metrics.reportCount ?? 0}`);
      text('synthesisApprovalRate', `${Number(metrics.approvalRate || 0).toFixed(1)} % des rapports`);
      text('synthesisHours', `${Number(metrics.totalHours || 0).toFixed(1)} h`);
      text('synthesisAgentsActive', `${metrics.activeAgents || 0} agent${Number(metrics.activeAgents || 0) === 1 ? '' : 's'} avec activité · ${metrics.selectedAgents || 0} dans le périmètre`);
      const categories = $('synthesisCategories');
      if (categories) {
        categories.innerHTML = (data.categories || []).length
          ? `<strong>Domaines les plus représentés</strong>${data.categories.map(item => `<span>${escapeHtml(item.name)} <b>${Number(item.total)}</b></span>`).join('')}`
          : '';
      }
    } catch (error) {
      console.error('Erreur de génération de la synthèse :', error);
      narrative.textContent = error.message || 'Impossible de charger la synthèse.';
      text('synthesisScope', 'Données indisponibles');
    }
  }

  // --- Initialisation ---
  document.addEventListener('DOMContentLoaded', () => {
    const todayLabel = $('todayLabel');
    if (todayLabel) {
      todayLabel.textContent = new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date());
    }

    text('year', new Date().getFullYear());

    updateSynthesisDateRange($('synthesisPeriod')?.value || 'month');

    $('periodSelect')?.addEventListener('change', loadDashboard);$('exportButton')?.addEventListener('click', () => window.print());
    $('synthesisPeriod')?.addEventListener('change', () => {
      if ($('synthesisPeriod').value !== 'custom') updateSynthesisDateRange($('synthesisPeriod').value);
      loadSynthesis();
    });
    ['synthesisStartDate', 'synthesisEndDate'].forEach(id => $(id)?.addEventListener('change', () => {
      $('synthesisPeriod').value = 'custom';
      loadSynthesis();
    }));
    $('synthesisAgents')?.addEventListener('change', loadSynthesis);
    $('refreshSynthesis')?.addEventListener('click', loadSynthesis);
    $('printSynthesis')?.addEventListener('click', () => window.print());
    $('notationSearch')?.addEventListener('input', () => {
      clearTimeout(notationSearchTimer);
      notationSearchTimer = setTimeout(loadDepartmentEvaluations, 250);
    });
    ['notationRating', 'notationDateFrom', 'notationDateTo'].forEach(id => $(id)?.addEventListener('change', loadDepartmentEvaluations));
    $('notationRefresh')?.addEventListener('click', loadDepartmentEvaluations);
    $('rankingSearch')?.addEventListener('input', () => {
      clearTimeout(rankingSearchTimer);
      rankingSearchTimer = setTimeout(loadAgentRankings, 250);
    });
    ['rankingSort', 'rankingDateFrom', 'rankingDateTo'].forEach(id => $(id)?.addEventListener('change', loadAgentRankings));
    $('rankingRefresh')?.addEventListener('click', loadAgentRankings);
    $('proposalSearch')?.addEventListener('input', () => {
      clearTimeout(proposalSearchTimer);
      proposalSearchTimer = setTimeout(loadDepartmentProposals, 250);
    });
    $('proposalStatusFilter')?.addEventListener('change', loadDepartmentProposals);
    $('proposalRefresh')?.addEventListener('click', loadDepartmentProposals);
    $('proposalTableBody')?.addEventListener('click', event => {
      const button = event.target.closest('[data-proposal-id][data-decision]');
      if (button) decideProposal(button.dataset.proposalId, button.dataset.decision);
    });
    $('menuToggle')?.addEventListener('click', () =>$('sidebar')?.classList.toggle('open'));
    $('teamNavLink')?.addEventListener('click', (event) => { event.preventDefault(); openTeamModal(); });
    $('openTeamButton')?.addEventListener('click', openTeamModal);
    $('closeTeamModal')?.addEventListener('click', closeTeamModal);
    $('teamBackButton')?.addEventListener('click', renderTeamModalList);
    $('activitySearch')?.addEventListener('input', () => {
      clearTimeout(activitySearchTimer);
      activitySearchTimer = setTimeout(() => { activityPage = 1; loadActivities(); }, 250);
    });
    $('activityStatusFilter')?.addEventListener('change', () => { approvalQueueOnly = false; activityPage = 1; loadActivities(); });
    $('activityCategoryFilter')?.addEventListener('change', () => { activityPage = 1; loadActivities(); });
    $('activityPrev')?.addEventListener('click', () => { activityPage = Math.max(1, activityPage - 1); loadActivities(); });
    $('activityNext')?.addEventListener('click', () => { activityPage += 1; loadActivities(); });
    $('activityTableBody')?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-activity-id]');
      if (row) showActivityDetails(row.dataset.activityId);
    });
    $('activityModalContent')?.addEventListener('click', (event) => {
      const statusButton = event.target.closest('[data-activity-status]');
      if (statusButton) {
        updateActivityStatus(statusButton.dataset.activityId, statusButton.dataset.activityStatus);
        return;
      }
      const decisionButton = event.target.closest('[data-activity-decision]');
      if (decisionButton) decideActivity(decisionButton.dataset.activityId, decisionButton.dataset.activityDecision);
    });
    $('approvalNotifications')?.addEventListener('click', () => {
      approvalQueueOnly = true;
      $('activityStatusFilter').value = '';
      activityPage = 1;
      $('activities')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      loadActivities();
    });
    $('activityTableBody')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        const row = event.target.closest('tr[data-activity-id]');
        if (row) { event.preventDefault(); showActivityDetails(row.dataset.activityId); }
      }
    });
    $('closeActivityModal')?.addEventListener('click', closeActivityModal);
    $('activityModal')?.addEventListener('click', (event) => {
      if (event.target.matches('[data-close-activity-modal]')) closeActivityModal();
    });
    $('teamModal')?.addEventListener('click', (event) => {
      if (event.target.matches('[data-close-team-modal]')) closeTeamModal();
      // Seuls les boutons de la liste ouvrent un profil. Le formulaire de notation
      // porte aussi data-agent-id, mais ses clics ne doivent pas recharger le profil.
      const agentButton = event.target.closest('button.directory-agent[data-agent-id]');
      if (agentButton) showAgentProfile(agentButton.dataset.agentId);
    });
    $('teamModalContent')?.addEventListener('submit', submitAgentEvaluation);
    $('teamList')?.addEventListener('click', (event) => {
      const agentRow = event.target.closest('[data-agent-id]');
      if (agentRow) { openTeamModal(); showAgentProfile(agentRow.dataset.agentId); }
    });
    $('teamList')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        const agentRow = event.target.closest('[data-agent-id]');
        if (agentRow) { event.preventDefault(); openTeamModal(); showAgentProfile(agentRow.dataset.agentId); }
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && $('teamModal')?.classList.contains('open')) closeTeamModal();
      if (event.key === 'Escape' && $('activityModal')?.classList.contains('open')) closeActivityModal();
    });

    loadDashboard();
    loadSynthesis();
    loadActivities();
    loadDepartmentEvaluations();
    loadAgentRankings();
    loadDepartmentProposals();
    window.setInterval(loadActivities, 60000);
  });
})();
