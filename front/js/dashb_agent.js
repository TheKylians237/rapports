document.addEventListener('DOMContentLoaded', () => {
  // Éléments du DOM
  const reportForm = document.getElementById('reportForm');
  const proposalForm = document.getElementById('proposalForm');
  const tasksContainer = document.getElementById('tasksContainer');
  const reportsList = document.getElementById('reportsList');
  const toastContainer = document.getElementById('toastContainer');
  const currentDateDisplay = document.getElementById('currentDateDisplay');
  const navName = document.getElementById('navName');
  const navUserPrefix = document.getElementById('navUserPrefix');
  const themeToggle = document.getElementById('themeToggle');
  const titre = document.getElementById('titre');

  // Éléments de statistiques
  const statHours = document.getElementById('statHours');
  const statTasks = document.getElementById('statTasks');
  const statIssues = document.getElementById('statIssues');

  // État applicatif
  let currentPeriod = 'journalier';
  let searchQuery = '';
  let statusFilter = '';

  // --- 0. RÉCUPÉRATION DU TOKEN ET DES PARAMÈTRES UTILISATEUR ---
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');
  const urlParams = new URLSearchParams(window.location.search);
  const username = urlParams.get('username') || localStorage.getItem('username') || 'Agent';
  const id = urlParams.get('user_id') || urlParams.get('id') || localStorage.getItem('userId');

  // Helper pour générer les headers sécurisés avec le token JWT
  function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  async function loadDepartmentChefs() {
    const select = document.getElementById('reportReviewer');
    const help = document.getElementById('reportReviewerHelp');
    if (!select) return;
    try {
      const response = await fetch('/api/auth/agent/department-chefs', { headers: getAuthHeaders() });
      const result = await response.json();
      if (response.status === 401) {
        showToast('Session expirée, veuillez vous reconnecter.', 'danger');
        setTimeout(() => { window.location.href = '/index.html'; }, 1200);
        return;
      }
      if (!response.ok || !result.success) throw new Error(result.message || 'Impossible de charger les chefs de service.');
      const managers = result.managers || [];
      select.innerHTML = '<option value="">Choisir un chef de service</option>' + managers.map(manager => {
        const label = [manager.name, manager.jobTitle || 'Chef de service'].filter(Boolean).join(' · ');
        return `<option value="${escapeHtml(manager.id)}">${escapeHtml(label)}</option>`;
      }).join('');
      select.disabled = managers.length === 0;
      if (help) help.textContent = managers.length
        ? `Destinataires actifs de votre département : ${result.department}.`
        : `Aucun chef de service actif n’est enregistré dans le département ${result.department || 'de l’agent'}.`;
    } catch (error) {
      select.innerHTML = '<option value="">Liste des chefs indisponible</option>';
      select.disabled = true;
      if (help) help.textContent = error.message;
      showToast(error.message, 'danger');
    }
  }

  // Redirection si session absente
  if (!token && !id) {
    showToast('Session absente ou expirée. Redirection vers la connexion...', 'danger');
    setTimeout(() => { window.location.href = '/index.html'; }, 1500);
    return;
  }

  if (titre) {
    titre.style.color = 'BLUE';
    titre.textContent = "Tableau de bord de l'agent - ";
  }

  // 1. Thème Sombre / Clair
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      document.documentElement.setAttribute('data-theme', newTheme);
      themeToggle.textContent = newTheme === 'dark' ? '☀' : '🌙';
      
      if (navUserPrefix) {
        navUserPrefix.style.color = newTheme === 'dark' ? 'yellow' : 'blue';
      }
      themeToggle.style.backgroundColor = newTheme === 'dark' ? '#d4af37' : 'gray';
    });
  }

  // 2. Navigation et Profils avec Transmission des Identifiants
  if (username && navUserPrefix) {
    navUserPrefix.textContent = username.toUpperCase();
  }
  if (navName) {
    navName.textContent = username;
  }

  const linkProfile = document.getElementById('linkprofile');
  if (linkProfile && id) {
    linkProfile.href = `../html/profile.html?username=${encodeURIComponent(username)}&user_id=${encodeURIComponent(id)}`;
  }

  const btnStat = document.getElementById('statistiques');
  if (btnStat && id) {
    btnStat.addEventListener('click', () => {
      window.location.href = `../html/Stat_dashb.html?username=${encodeURIComponent(username)}&user_id=${encodeURIComponent(id)}`;
    });
  }

  // Mise à jour de la date du jour
  if (currentDateDisplay) {
    currentDateDisplay.textContent = new Date().toLocaleDateString('fr-FR');
  }

  // --- FONCTIONS DU DASHBOARD ---

  async function loadDashboardData() {
    try {
      const queryParams = new URLSearchParams({
        user_id: id || '',
        period: currentPeriod,
        search: searchQuery,
        status: statusFilter
      });

      const response = await fetch(`/api/reports?${queryParams.toString()}`, {
        method: 'GET',
        headers: getAuthHeaders()
      });

      if (response.status === 401) {
        showToast('Session expirée, veuillez vous reconnecter.', 'danger');
        setTimeout(() => window.location.href = '/index.html', 1500);
        return;
      }

      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Erreur lors du chargement des rapports');

      updateStatsUI(result.stats);
      renderReportsList(result.reports);

    } catch (error) {
      console.error('Erreur lors du chargement des données:', error);
      showToast('Erreur lors de la récupération des rapports', 'danger');
    }
  }

  function updateStatsUI(stats) {
    if (!stats) return;
    if (statHours) statHours.textContent = `${parseFloat(stats.total_hours || 0).toFixed(1)} hrs`;
    if (statTasks) statTasks.textContent = stats.total_reports || '0';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function renderReportsList(reports) {
    if (!reportsList) return;

    if (!reports || reports.length === 0) {
      reportsList.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 16px;">Aucun rapport trouvé pour cette période.</p>`;
      return;
    }

    reportsList.innerHTML = reports.map(report => {
      const reportDateFormatted = new Date(report.report_date).toLocaleDateString('fr-FR');
      let badgeClass = 'badge-warning';
      let statusText = 'En attente';

      if (report.status === 'approved') {
        badgeClass = 'badge-success';
        statusText = 'Validé';
      } else if (report.status === 'rejected') {
        badgeClass = 'badge-danger';
        statusText = 'Rejeté';
      }

      return `
        <div class="report-item" style="border-bottom: 1px solid var(--border-color); padding: 12px 0;">
          <div class="report-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="report-user" style="font-weight: bold;">${escapeHtml(report.last_name || report.username)}</span>
            <span class="report-date" style="font-size: 0.85rem; color: var(--text-muted);">Soumis le : ${reportDateFormatted} à : ${report.report_hours || ''} -------- Nombre des heures totales : ${report.total_hours} hrs</span>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin: 6px 0;">
            ${escapeHtml(report.general_comments || 'Aucune description fournie')}
          </p>
          ${report.next_day_targets ? `<small style="display: block; color: var(--primary);">🎯 Difficultés constatées : ${escapeHtml(report.next_day_targets)}</small>` : ''}
          <span class="badge ${badgeClass}" style="margin-top: 6px; display: inline-block;">${statusText}</span>
        </div>
      `;
    }).join('');
  }

  async function loadProposalActivityOptions() {
    const select = document.getElementById('proposalActivityId');
    if (!select) return;
    try {
      const response = await fetch('/api/auth/agent/activities', { headers: getAuthHeaders() });
      const result = await response.json();
      if (response.status === 401) throw new Error('Session expirée. Reconnectez-vous pour continuer.');
      if (!response.ok || !result.success) throw new Error(result.message || 'Impossible de charger vos activités.');
      const activities = result.activities || [];
      select.innerHTML = '<option value="">Choisissez une activité</option>' + activities.map(activity => {
        const date = activity.reportDate ? new Date(`${String(activity.reportDate).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : 'Date inconnue';
        const label = `${activity.description} · ${date}${activity.category ? ` · ${activity.category}` : ''}`;
        return `<option value="${escapeHtml(activity.id)}">${escapeHtml(label)}</option>`;
      }).join('');
      select.disabled = activities.length === 0;
      if (!activities.length) select.innerHTML = '<option value="">Aucune activité enregistrée</option>';
    } catch (error) {
      select.innerHTML = `<option value="">${escapeHtml(error.message)}</option>`;
      select.disabled = true;
    }
  }

  async function chargerStatistiquesAgent(userId) {
    if (!userId) return;
    try {
      const response = await fetch(`/api/auth/agent-stats?user_id=${encodeURIComponent(userId)}`, {
        method: 'GET',
        headers: getAuthHeaders()
      });

      if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);

      const result = await response.json();
      if (!result.success) return;

      const { heures, taches, difficultes } = result.data;

      const statHoursEl = document.getElementById('statHours');
      const statHourstext = document.getElementById('statHourtext');
      if (statHoursEl) statHoursEl.textContent = `${heures.totales} hrs`;
      if (statHourstext) {
        const signe = heures.pourcentage >= 0 ? '↑ +' : '↓ ';
        statHourstext.textContent = `${signe}${heures.pourcentage}%`;
      }

      const statTasksEl = document.getElementById('statTasks');
      const statTasktext = document.getElementById('statTasktext');
      if (statTasksEl) statTasksEl.textContent = taches.terminees;
      if (statTasktext) statTasktext.textContent = `${taches.pourcentage}%`;

      const statIssuesEl = document.getElementById('statIssues');
      if (statIssuesEl) statIssuesEl.textContent = difficultes.totales;

    } catch (error) {
      console.error('❌ Erreur chargement stats :', error);
    }
  }

  // --- SOUMISSION DU FORMULAIRE ET ENVOI DU RAPPORT ---

  async function envoyerRapport(event) {
    if (event) event.preventDefault();

    if (!id) {
      alert("Erreur: L'identifiant de l'utilisateur est manquant.");
      return;
    }

    const submittedTo = document.getElementById('reportReviewer')?.value || '';
    if (!submittedTo) {
      alert('Choisissez le chef de service qui recevra ce rapport.');
      document.getElementById('reportReviewer')?.focus();
      return;
    }

    const taskRows = document.querySelectorAll('.task-row');
    const activities = [];
    let totalHours = 0;
    let commentsArr = [];

    taskRows.forEach(row => {
      const descInput = row.querySelector('.task-desc');
      const catSelect = row.querySelector('.task-category');
      const hoursInput = row.querySelector('.task-hours');

      if (descInput && catSelect && hoursInput) {
        const description = descInput.value.trim();
        const category = catSelect.value;
        const hoursVal = parseFloat(hoursInput.value) || 0;

        if (description) {
          activities.push({
            description: description,
            category: category,
            hours: hoursVal
          });
          totalHours += hoursVal;
          commentsArr.push(description);
        }
      }
    });

    if (activities.length === 0) {
      alert("Veuillez saisir au moins une activité valide.");
      return;
    }

    const commentsTextarea = document.getElementById('com');
    const formattedComments = commentsArr.join('\n');

    const payload = {
      user_id: id,
      submitted_to: submittedTo,
      total_hours: totalHours,
      general_comments: formattedComments,
      next_day_targets: commentsTextarea ? commentsTextarea.value.trim() : '',
      activities: activities,
      date: (() => {
        const today = new Date();
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      })()
    };

    try {
      const response = await fetch('/api/auth/reports-store', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok) {
        showToast('Rapport enregistré avec succès !', 'success');
        reportForm.reset();
        await loadDashboardData();
        await loadProposalActivityOptions();
        chargerStatistiquesAgent(id);
      } else {
        alert(`Erreur : ${result.error || result.message || 'Impossible d\'enregistrer le rapport.'}`);
      }
    } catch (error) {
      console.error('Erreur lors de la soumission :', error);
      alert('Erreur réseau lors de l\'enregistrement.');
    }
  }

  // Attachement unique du formulaire
  if (reportForm) {
    reportForm.addEventListener('submit', envoyerRapport);
  }

  async function envoyerProposition(event) {
    event.preventDefault();
    const activityId = document.getElementById('proposalActivityId')?.value || '';
    const issueDescription = document.getElementById('issueDescription')?.value.trim() || '';
    const proposedSolution = document.getElementById('proposedSolution')?.value.trim() || '';
    const submitButton = proposalForm?.querySelector('button[type="submit"]');
    if (!activityId) { alert('Choisissez l’activité concernée par cette proposition.'); return; }
    if (!issueDescription) { alert('Décrivez la difficulté ou le besoin signalé.'); return; }
    if (submitButton) submitButton.disabled = true;
    try {
      const response = await fetch('/api/auth/report-issues', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          activity_id: activityId,
          issue_description: issueDescription,
          proposed_solution: proposedSolution,
          needs_manager_help: Boolean(document.getElementById('needsManagerHelp')?.checked)
        })
      });
      const result = await response.json();
      if (response.status === 401) {
        showToast('Session expirée, veuillez vous reconnecter.', 'danger');
        setTimeout(() => { window.location.href = '/index.html'; }, 1200);
        return;
      }
      if (!response.ok || !result.success) throw new Error(result.message || 'Impossible de soumettre la proposition.');
      proposalForm.reset();
      showToast(result.message || 'Proposition soumise.', 'success');
      await loadDashboardData();
      chargerStatistiquesAgent(id);
    } catch (error) {
      console.error('Erreur lors de la soumission de la proposition :', error);
      showToast(error.message || 'Erreur réseau lors de la soumission.', 'danger');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  if (proposalForm) proposalForm.addEventListener('submit', envoyerProposition);

  // Notification Toast Utilitaires
  function showToast(message, type = 'success') {
    if (!toastContainer) {
      alert(message);
      return;
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // --- FONCTIONS EXPOSÉES AU WINDOW ---

  window.addTaskRow = function() {
    if (!tasksContainer) return;
    const row = document.createElement('div');
    row.className = 'task-row';
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.marginTop = '8px';
    row.innerHTML = `
      <input type="text" class="input-control task-desc" placeholder="Description de l'activité..." required style="flex: 2;">
      <select class="input-control task-category" style="flex: 1;">
        <option value="Développement">Développement</option>
        <option value="Support & Assistance">Support & Assistance</option>
        <option value="Réunion & Coordination">Réunion & Coordination</option>
        <option value="Documentation">Documentation</option>
      </select>
      <input type="number" step="0.5" min="0.5" max="24" class="input-control task-hours" placeholder="Hrs" value="1" required style="width: 70px;">
      <button type="button" class="btn btn-danger" onclick="removeTaskRow(this)">✕</button>
    `;
    tasksContainer.appendChild(row);
  };

  window.removeTaskRow = function(button) {
    const rows = document.querySelectorAll('.task-row');
    if (rows.length > 1) {
      button.parentElement.remove();
    } else {
      alert("Le rapport doit contenir au moins une activité.");
    }
  };

  window.setPeriod = function(period, btn) {
    currentPeriod = period;
    document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadDashboardData();
  };

  // Chargement initial des données
  loadDepartmentChefs();
  loadDashboardData();
  loadProposalActivityOptions();
  chargerStatistiquesAgent(id);
});
