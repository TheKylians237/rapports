/**
 * Formate un nombre d'heures décimal en format lisible (ex: 3.5 -> "3h30")
 */
function fmtHours(h) {
  if (isNaN(h) || h === null) return "0h00";
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return `${hours}h${String(mins).padStart(2, "0")}`;
}

/**
 * Échappe les caractères HTML dangereux
 */
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

// --- HELPER AUTHENTIFICATION TOKEN JWT ---
function getAuthHeaders() {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// Helper de gestion d'expiration de session
function handleAuthError(response) {
  if (response.status === 401) {
    alert("Votre session a expiré. Veuillez vous reconnecter.");
    window.location.href = "/index.html";
    return true;
  }
  return false;
}

/**
 * Charge et affiche les statistiques calculées par le backend
 * @param {string|number} userId
 */
async function loadDashboardStats(userId) {
  const dateFromInput = document.getElementById("datePickerFrom");
  const dateEndInput = document.getElementById("datePickerEnd");
  const statusFilter = document.getElementById("statusFilter");

  let startDate = dateFromInput ? dateFromInput.value : "";
  let endDate = dateEndInput ? dateEndInput.value : "";

  if (startDate && endDate && startDate > endDate) {
    alert("La date de début ne peut pas être supérieure à la date de fin.");
    dateFromInput.value = endDate;
    startDate = endDate;
  }

  // Mise à jour du texte de synthèse
  if (startDate && endDate) {
    const formattedDateFrom = new Date(startDate + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const formattedDateEnd = new Date(endDate + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    
    const periodElem = document.getElementById("periodText");
    if (periodElem) {
      periodElem.textContent = `SYNTHÈSE DES ACTIVITÉS DU ${formattedDateFrom} AU ${formattedDateEnd}`.toUpperCase();
    }
  }

  const selectedStatus = statusFilter ? statusFilter.value : "all";

  try {
    const url = `/api/auth/dashboard-stats?user_id=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&status=${encodeURIComponent(selectedStatus)}`;

    const response = await fetch(url, { headers: getAuthHeaders() });

    if (handleAuthError(response)) return;
    if (!response.ok) throw new Error(`Erreur réseau HTTP (${response.status})`);

    const data = await response.json();

    // Mise à jour des cartes KPI
    if (document.getElementById("totalHours")) document.getElementById("totalHours").textContent = fmtHours(data.totalHours);
    if (document.getElementById("reportCount")) document.getElementById("reportCount").textContent = data.reportCount || 0;
    if (document.getElementById("avgHours")) document.getElementById("avgHours").textContent = fmtHours(data.avgHours);
    if (document.getElementById("pendingCount")) document.getElementById("pendingCount").textContent = data.pendingCount || 0;
    if (document.getElementById("completedCount")) document.getElementById("completedCount").textContent = data.completedCount || 0;
    if (document.getElementById("tasknumber")) document.getElementById("tasknumber").textContent = data.taskNumber || 0;
    if (document.getElementById("commentsnumber")) document.getElementById("commentsnumber").textContent = data.commentsNumber || 0;

  } catch (error) {
    console.error("Erreur lors de la mise à jour du tableau de bord :", error);
  }
}

/**
 * Charge les données d'activités depuis la BD et dessine le graphique
 */
async function loadHourlyChart(userId) {
  const dateFromInput = document.getElementById("datePickerFrom");
  const dateEndInput = document.getElementById("datePickerEnd");

  const startDate = dateFromInput ? dateFromInput.value : "";
  const endDate = dateEndInput ? dateEndInput.value : "";

  try {
    const url = `/api/auth/hourly-chart-data?user_id=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (handleAuthError(response)) return;
    if (!response.ok) throw new Error(`Erreur HTTP (${response.status})`);

    const activities = await response.json();
    renderHourlyChart(activities);

  } catch (error) {
    console.error("Erreur lors du chargement du graphique :", error);
    const chartElem = document.getElementById("chart");
    if (chartElem) chartElem.innerHTML = '<span class="muted" style="margin:auto;">Impossible de charger le graphique.</span>';
  }
}

/**
 * Génère le HTML du graphique en barres
 */
function renderHourlyChart(activities) {
  const chartElem = document.getElementById("chart");
  if (!chartElem) return;

  if (!activities || activities.length === 0) {
    chartElem.innerHTML = '<span class="muted" style="margin: auto;">Aucune donnée d’activité enregistrée.</span>';
    return;
  }

  const maxPixels = 140; // Hauteur max de la barre en px
  const maxDuration = Math.max(...activities.map(a => Number(a.duration)), 1);

  chartElem.innerHTML = activities.map(act => {
    const durationNum = Number(act.duration) || 0;
    const barHeight = Math.max(12, Math.round((durationNum / maxDuration) * maxPixels));

    return `
      <div class="barwrap">
        <span class="bartime">${fmtHours(durationNum)}</span>
        <div class="bar" style="height: ${barHeight}px;"></div>
        <span class="barlabel">${escapeHtml(act.time)}</span>
      </div>
    `;
  }).join("");
}

/**
 * Charge l'état des rapports depuis le backend
 */
async function loadReportStatus(userId) {
  const startDate = document.getElementById("datePickerFrom")?.value || "";
  const endDate = document.getElementById("datePickerEnd")?.value || "";

  try {
    const url = `/api/auth/report-status?user_id=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (handleAuthError(response)) return;
    if (!response.ok) throw new Error(`Erreur HTTP (${response.status})`);

    const data = await response.json();
    renderReportStatus(data);

  } catch (error) {
    console.error("Erreur lors du chargement de l'état des rapports :", error);
  }
}

/**
 * Applique les données reçues aux éléments HTML
 */
function renderReportStatus(data) {
  const approved = data.approved || 0;
  const pending = data.pending || 0;
  const rejected = data.rejected || 0;
  const total = data.total || 1;

  if (document.getElementById("approvedN")) document.getElementById("approvedN").textContent = approved;
  if (document.getElementById("pendingN")) document.getElementById("pendingN").textContent = pending;
  if (document.getElementById("rejectedN")) document.getElementById("rejectedN").textContent = rejected;

  const approvedPercent = Math.round((approved / total) * 100);
  const pendingPercent = Math.round((pending / total) * 100);
  const rejectedPercent = Math.round((rejected / total) * 100);

  if (document.getElementById("approvedP")) document.getElementById("approvedP").style.width = `${approvedPercent}%`;
  if (document.getElementById("pendingP")) document.getElementById("pendingP").style.width = `${pendingPercent}%`;
  if (document.getElementById("rejectedP")) document.getElementById("rejectedP").style.width = `${rejectedPercent}%`;

  if (document.getElementById("validationRate")) document.getElementById("validationRate").textContent = `${data.validationRate || 0}%`;
}

/**
 * Charge les activités de la timeline depuis la BDD
 */
async function loadTimeline(userId) {
  const startDate = document.getElementById("datePickerFrom")?.value || "";
  const endDate = document.getElementById("datePickerEnd")?.value || "";
  const selectedStatus = document.getElementById("statusFilter")?.value || "all";

  try {
    const url = `/api/auth/timeline-activities?user_id=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&status=${encodeURIComponent(selectedStatus)}`;
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (handleAuthError(response)) return;
    if (!response.ok) throw new Error(`Erreur HTTP (${response.status})`);

    const activities = await response.json();
    renderTimeline(activities);

  } catch (error) {
    console.error("Erreur lors du chargement de la chronologie :", error);
    const timelineContainer = document.getElementById("timeline");
    if (timelineContainer) timelineContainer.innerHTML = '<span class="muted">Erreur de chargement des activités.</span>';
  }
}

/**
 * Génère le code HTML exact pour la timeline
 */
function renderTimeline(activities) {
  const timelineContainer = document.getElementById("timeline");
  if (!timelineContainer) return;

  if (!activities || activities.length === 0) {
    timelineContainer.innerHTML = '<span class="muted">Aucune activité enregistrée pour cette période.</span>';
    return;
  }

  timelineContainer.innerHTML = activities.map(act => {
    let statusClass = "pending";
    const statusLower = String(act.status || '').toLowerCase();
    
    if (statusLower.includes("valid") || statusLower.includes("approved") || statusLower.includes("completed")) {
      statusClass = "approved";
    } else if (statusLower.includes("rejet") || statusLower.includes("rejected")) {
      statusClass = "rejected";
    }

    return `
      <div class="activity">
        <div class="time">
          ${act.time || '00:00'}<br>${act.end_time || '00:00'}
        </div>
        <div class="dotcol">
          <div class="dot"></div>
        </div>
        <div class="activitybox">
          <span class="status ${statusClass}">${escapeHtml(act.status || 'En attente')}</span>
          <strong>${escapeHtml(act.title)}</strong>
          <p>Domaine : ${escapeHtml(act.objective)}</p>
          <div class="tags">
            <span class="tag">${fmtHours(act.duration)}</span>
            <span class="tag">Rapport d’activité</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/**
 * Charge les objectifs depuis la BD
 */
async function loadObjectives(userId) {
  const startDate = document.getElementById("datePickerFrom")?.value || "";
  const endDate = document.getElementById("datePickerEnd")?.value || "";

  try {
    const url = `/api/auth/objectives?user_id=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (handleAuthError(response)) return;
    if (!response.ok) throw new Error(`Erreur HTTP (${response.status})`);

    const objectives = await response.json();
    renderObjectives(objectives);

  } catch (error) {
    console.error("Erreur lors du chargement des objectifs :", error);
    const container = document.getElementById("objectives");
    if (container) container.innerHTML = '<span class="muted">Erreur de chargement.</span>';
  }
}

function renderObjectives(objectivesList) {
  const container = document.getElementById("objectives");
  if (!container) return;

  if (!objectivesList || objectivesList.length === 0) {
    container.innerHTML = '<span class="muted">Aucun objectif disponible.</span>';
    return;
  }

  container.innerHTML = objectivesList.map((obj, index) => `
    <div class="objective">
      <strong>Objectif ${index + 1}</strong>
      <p>${escapeHtml(obj)}</p>
    </div>
  `).join("");
}

/**
 * Charge la synthèse professionnelle
 */
async function loadProfessionalSummary(userId) {
  const startDate = document.getElementById("datePickerFrom")?.value || "";
  const endDate = document.getElementById("datePickerEnd")?.value || "";

  try {
    const url = `/api/auth/professional-summary?user_id=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (handleAuthError(response)) return;
    if (!response.ok) throw new Error(`Erreur HTTP (${response.status})`);

    const data = await response.json();
    renderProfessionalSummary(data);

  } catch (error) {
    console.error("Erreur lors du chargement de la synthèse professionnelle :", error);
    const container = document.getElementById("summary");
    if (container) container.innerHTML = '<span class="muted">Erreur de chargement de la synthèse professionnelle.</span>';
  }
}

function renderProfessionalSummary(data) {
  const container = document.getElementById("summary");
  if (!container) return;

  if (!data || data.totalActivities === 0) {
    container.innerHTML = '<span class="muted">Aucune activité enregistrée pour cette période.</span>';
    return;
  }

  const dateStartFormatted = new Date(data.startDate + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  const dateEndFormatted = new Date(data.endDate + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

  container.innerHTML = `
    <p><strong>BILAN DES ACTIVITÉS</strong></p>
    <p>
      Sur la période allant du <strong>${dateStartFormatted}</strong> au <strong>${dateEndFormatted}</strong>, le présent bilan rend compte des activités réalisées au cours de la période considérée.
    </p>
    <p>
      Les travaux effectués ont principalement porté sur <strong>${escapeHtml(data.descriptions)}</strong>.
    </p>
    <p>
      Ces différentes activités s’inscrivaient dans le cadre des objectifs suivants : <strong>${escapeHtml(data.objectives)}</strong>.
    </p>
    <p>
      Au cours de la période considérée, les activités enregistrées présentent différents niveaux d’avancement : terminées (<strong>${data.completedCount || 0}</strong>), en attente (<strong>${data.pendingCount || 0}</strong>).
    </p>
    <p>
      L’ensemble des travaux réalisés au cours de cette période traduit les appréciations (<strong>${escapeHtml(data.observations)}</strong>).
    </p>
  `;
}

async function loadMyEvaluations() {
  const list = document.getElementById('myEvaluationsList');
  const average = document.getElementById('myEvaluationAverage');
  if (!list) return;
  try {
    const params = new URLSearchParams();
    const filters = {
      search: document.getElementById('myEvaluationsSearch')?.value.trim(),
      rating: document.getElementById('myEvaluationsRating')?.value,
      dateFrom: document.getElementById('myEvaluationsDateFrom')?.value,
      dateTo: document.getElementById('myEvaluationsDateTo')?.value,
    };
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    const response = await fetch(`/api/auth/agent/my-evaluations?${params}`, { headers: getAuthHeaders() });
    if (handleAuthError(response)) return;
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || `Erreur HTTP ${response.status}`);
    const evaluations = data.evaluations || [];
    const evaluationCount = Number(data.count || 0);
    if (average) average.textContent = `Moyenne : ${evaluationCount ? Number(data.average || 0).toFixed(1) : '—'} / 5 · ${evaluationCount} avis`;
    if (!evaluations.length) {
      list.innerHTML = '<p class="muted">Aucune notation ou aucun avis disponible pour le moment.</p>';
      return;
    }
    list.innerHTML = evaluations.map(evaluation => `
      <article style="padding:14px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
          <strong>${escapeHtml(evaluation.managerName || 'Chef de service')} · ${Number(evaluation.rating)}/5</strong>
          <time class="muted">${escapeHtml(evaluation.evaluationDate || '')}</time>
        </div>
        <p style="margin:8px 0 0;line-height:1.6;">${escapeHtml(evaluation.comment || '')}</p>
      </article>
    `).join('');
  } catch (error) {
    console.error('Erreur lors du chargement des évaluations :', error);
    list.innerHTML = `<p class="muted">${escapeHtml(error.message || 'Impossible de charger les évaluations.')}</p>`;
  }
}

async function loadMyProposals() {
  const body = document.getElementById('myProposalsTableBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center">Chargement des propositions…</td></tr>';
  const params = new URLSearchParams();
  const search = document.getElementById('myProposalsSearch')?.value.trim();
  const status = document.getElementById('myProposalsStatus')?.value;
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  try {
    const response = await fetch(`/api/auth/agent/my-proposals?${params}`, { headers: getAuthHeaders() });
    if (handleAuthError(response)) return;
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || `Erreur HTTP ${response.status}`);
    const proposals = data.proposals || [];
    if (!proposals.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center">Aucune proposition pour ces filtres.</td></tr>';
      return;
    }
    body.innerHTML = proposals.map(item => {
      const state = String(item.status || 'Pending').toLowerCase();
      const stateLabel = state === 'approved' ? 'Approuvée' : state === 'rejected' ? 'Rejetée' : 'En attente';
      const stateClass = state === 'approved' ? 'approved' : state === 'rejected' ? 'rejected' : 'pending';
      return `<tr>
        <td>${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleDateString('fr-FR') : item.reportDate || '—')}</td>
        <td>${escapeHtml(item.activityDescription || 'Activité')}</td>
        <td>${escapeHtml(item.description || '')}</td>
        <td>${escapeHtml(item.proposedSolution || '—')}</td>
        <td><span class="badge ${stateClass}">${stateLabel}</span></td>
        <td>${escapeHtml(item.reviewComment || (state === 'pending' ? 'En attente de traitement' : 'Aucun avis'))}${item.reviewerName ? `<small style="display:block;color:var(--muted)">Par ${escapeHtml(item.reviewerName)}</small>` : ''}</td>
      </tr>`;
    }).join('');
  } catch (error) {
    console.error('Erreur de chargement des propositions :', error);
    body.innerHTML = `<tr><td colspan="6" class="muted" style="text-align:center">${escapeHtml(error.message || 'Impossible de charger les propositions.')}</td></tr>`;
  }
}

/**
 * Charge l'historique détaillé
 */
async function loadDetailedHistory(userId) {
  const startDate = document.getElementById("datePickerFrom")?.value || "";
  const endDate = document.getElementById("datePickerEnd")?.value || "";
  const selectedStatus = document.getElementById("statusFilter")?.value || "all";

  try {
    const url = `/api/auth/detailed-history?user_id=${encodeURIComponent(userId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&status=${encodeURIComponent(selectedStatus)}`;
    const response = await fetch(url, { headers: getAuthHeaders() });

    if (handleAuthError(response)) return;
    if (!response.ok) throw new Error(`Erreur HTTP (${response.status})`);

    const rows = await response.json();
    renderDetailedHistory(rows);

  } catch (error) {
    console.error("Erreur lors du chargement de l'historique détaillé :", error);
    const tableBody = document.getElementById("tableBody");
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; color:red;">
            Erreur lors du chargement des données.
          </td>
        </tr>
      `;
    }
  }
}

function renderDetailedHistory(rows) {
  const tableBody = document.getElementById("tableBody");
  if (!tableBody) return;

  if (!rows || rows.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;" class="muted">
          Aucune donnée disponible pour cette période.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = rows.map(x => {
    let statusClass = "pending";
    const statusLower = String(x.status || '').toLowerCase();

    if (statusLower.includes("valid") || statusLower.includes("approved") || statusLower.includes("completed") || statusLower.includes("terminé")) {
      statusClass = "approved";
    } else if (statusLower.includes("rejet") || statusLower.includes("rejected")) {
      statusClass = "rejected";
    }

    return `
      <tr>
        <td><strong>${x.date || '--/--/----'}</strong></td>
        <td>${x.start_time || '00:00'} – ${x.end_time || '00:00'}</td>
        <td><strong>${escapeHtml(x.activity || '')}</strong></td>
        <td>${escapeHtml(x.objective || '')}</td>
        <td>${escapeHtml(x.difficulties || '')}</td>
        <td>${fmtHours(x.duration || 0)}</td>
        <td>
          <span class="badge ${statusClass}">${escapeHtml(x.status || 'En attente')}</span>
        </td>
      </tr>
    `;
  }).join("");
}

function printSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) {
    console.error(`Section avec l'ID #${sectionId} introuvable.`);
    return;
  }
  section.classList.add("print-only-section");
  window.print();
  section.classList.remove("print-only-section");
}

// --- INITIALISATION AU CHARGEMENT ---
document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const currentUserId = urlParams.get('user_id') || urlParams.get('id') || localStorage.getItem('userId');
  const username = urlParams.get('username') || localStorage.getItem('username') || 'Agent';
  const datePickerFrom = document.getElementById("datePickerFrom");
  const datePickerEnd = document.getElementById("datePickerEnd");
  const statusFilter = document.getElementById("statusFilter");

  // Mise à jour de l'en-tête
  const btnUser = document.getElementById('userName');
  if (btnUser) btnUser.textContent = username.toUpperCase();

  const us = document.getElementById("us");
  if (us) us.textContent = username.toUpperCase();

  const profileLink = document.getElementById('profileLink');
  if (profileLink && currentUserId) {
    profileLink.href = `../html/profile.html?username=${encodeURIComponent(username)}&user_id=${encodeURIComponent(currentUserId)}`;
  }

  const userAvatar = document.getElementById('userAvatar');
  if (userAvatar) userAvatar.textContent = username.slice(0, 2).toUpperCase();

  const manageActivities = document.getElementById('manageActivities');
  if (manageActivities && currentUserId) {
    manageActivities.addEventListener('click', () => {
      window.location.href = `../html/dashb_agent.html?username=${encodeURIComponent(username)}&user_id=${encodeURIComponent(currentUserId)}`;
    });
  }

  const dateToday = new Date();
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (datePickerFrom && !datePickerFrom.value) datePickerFrom.value = localDate(new Date(dateToday.getFullYear(), dateToday.getMonth(), 1));
  if (datePickerEnd && !datePickerEnd.value) datePickerEnd.value = localDate(dateToday);

  // Écouteurs sur les filtres
  const refreshAll = () => {
    loadDashboardStats(currentUserId);
    loadHourlyChart(currentUserId);
    loadReportStatus(currentUserId);
    loadTimeline(currentUserId);
    loadObjectives(currentUserId);
    loadProfessionalSummary(currentUserId);
    loadDetailedHistory(currentUserId);
  };

  if (datePickerFrom) datePickerFrom.addEventListener("change", refreshAll);
  if (datePickerEnd) datePickerEnd.addEventListener("change", refreshAll);
  if (statusFilter) statusFilter.addEventListener("change", refreshAll);
  document.getElementById('refreshEvaluations')?.addEventListener('click', loadMyEvaluations);
  let evaluationSearchTimer;
  document.getElementById('myEvaluationsSearch')?.addEventListener('input', () => {
    clearTimeout(evaluationSearchTimer);
    evaluationSearchTimer = setTimeout(loadMyEvaluations, 250);
  });
  ['myEvaluationsRating', 'myEvaluationsDateFrom', 'myEvaluationsDateTo'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', loadMyEvaluations);
  });
  let proposalSearchTimer;
  document.getElementById('myProposalsSearch')?.addEventListener('input', () => {
    clearTimeout(proposalSearchTimer);
    proposalSearchTimer = setTimeout(loadMyProposals, 250);
  });
  document.getElementById('myProposalsStatus')?.addEventListener('change', loadMyProposals);
  document.getElementById('refreshMyProposals')?.addEventListener('click', loadMyProposals);

  // Premier chargement global
  refreshAll();
  loadMyEvaluations();
  loadMyProposals();
});
