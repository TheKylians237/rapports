(() => {
  const API = '/api/auth/admin';
  const $ = id => document.getElementById(id);
  let users = [];
  let departments = [];
  let reportSearchTimer;
  let userSearchTimer;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const authHeaders = () => ({ Accept:'application/json', 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('token') || localStorage.getItem('authToken') || ''}` });
  const toast = message => {
    const container = $('toastContainer');
    if (!container) return;
    const item = document.createElement('div'); item.className='toast'; item.textContent=message; container.appendChild(item);
    setTimeout(()=>item.remove(),3500);
  };
  async function request(path, options={}) {
    const response = await fetch(`${API}${path}`, { ...options, headers:{...authHeaders(),...(options.headers||{})} });
    const data = await response.json().catch(()=>({message:'Réponse serveur invalide.'}));
    if (response.status===401 || response.status===403) {
      if (response.status===401) { localStorage.removeItem('token'); localStorage.removeItem('authToken'); window.location.href='D_auth.html'; }
      throw new Error(data.message || 'Accès réservé aux administrateurs.');
    }
    if (!response.ok) throw new Error(data.message || `Erreur HTTP ${response.status}`);
    return data;
  }
  const setText=(id,value)=>{if($(id))$(id).textContent=value;};

  function populateDepartments() {
    const opts=departments.filter(d=>Number(d.isActive)!==0).map(d=>`<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`).join('');
    ['userDept','deptFilter','reportDepartmentFilter'].forEach(id=>{
      const select=$(id);if(!select)return;
      const current=select.value;
      if(id==='userDept') select.innerHTML=opts || '<option value="">Créez d’abord un département</option>';
      else { const label=id==='deptFilter'?'Tous les Services':'Tous les départements';select.innerHTML=`<option value="">${label}</option>${opts}`; }
      if([...select.options].some(option=>option.value===current))select.value=current;
    });
  }

  async function loadOverview() {
    const data=await request('/overview');
    setText('kpiTotalUsers',Number(data.users?.total||0));
    setText('kpiUsersSubtext',`${Number(data.users?.active||0)} actifs · ${Number(data.users?.inactive||0)} désactivés`);
    setText('kpiTotalDepts',(data.departments||[]).filter(d=>Number(d.isActive)!==0).length);
    setText('kpiDepartmentsSubtext',`${Number(data.users?.managers||0)} chefs de service actifs`);
    const total=Number(data.reports?.total||0), approved=Number(data.reports?.approved||0);
    setText('kpiSubmissionRate',`${total?Math.round(approved*100/total):0} %`);
    setText('kpiReportsSubtext',`${total} rapports · ${Number(data.activities?.total||0)} activités`);
    setText('kpiPendingReports',Number(data.reports?.pending||0));
    setText('kpiPendingSubtext',`${Number(data.issues?.pending||0)} propositions en attente`);
  }

  async function loadDepartments() {
    const data=await request('/departments');departments=data.departments||[];populateDepartments();renderDepartments();
  }
  function renderDepartments() {
    const grid=$('deptsGrid');if(!grid)return;
    if(!departments.length){grid.innerHTML='<p class="empty-state">Aucun département. Créez-en un pour affecter les utilisateurs.</p>';return;}
    grid.innerHTML=departments.map(dept=>`<article class="dept-card ${Number(dept.isActive)===0?'dept-inactive':''}">
      <div class="dept-card-header"><div class="dept-title">${escapeHtml(dept.name)}</div><span class="status-badge ${Number(dept.isActive)===0?'status-suspended':'status-active'}">${Number(dept.isActive)===0?'Inactif':'Actif'}</span></div>
      <div class="dept-manager">Chef de service : <strong>${escapeHtml(dept.managerName||'Non désigné')}</strong></div>
      <div class="dept-stats"><span>Membres : <strong>${Number(dept.memberCount||0)}</strong></span><span>Agents : <strong>${Number(dept.agentCount||0)}</strong></span></div>
      <div class="dept-actions"><button class="btn btn-secondary btn-sm" onclick="editDepartment('${escapeHtml(dept.id)}')">Modifier</button>${Number(dept.isActive)!==0?`<button class="btn btn-danger btn-sm" onclick="deactivateDepartment('${escapeHtml(dept.id)}')">Désactiver</button>`:`<button class="btn btn-secondary btn-sm" onclick="activateDepartment('${escapeHtml(dept.id)}')">Réactiver</button>`}<button class="btn btn-danger btn-sm" onclick="deleteDepartment('${escapeHtml(dept.id)}')">Supprimer</button></div>
    </article>`).join('');
  }

  async function loadUsers() {
    const params=new URLSearchParams();
    ['search','role','department','status'].forEach(key=>{const id=key==='search'?'userSearch':key==='role'?'roleFilter':key==='department'?'deptFilter':'statusFilter';const value=$(id)?.value;if(value)params.set(key,value);});
    const body=$('usersTableBody');if(body)body.innerHTML='<tr><td colspan="6">Chargement des comptes…</td></tr>';
    try {
      const data=await request(`/users?${params}`);users=data.users||[];renderUsers();
    } catch(error) { if(body)body.innerHTML=`<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`; }
  }
  function renderUsers() {
    const tbody=$('usersTableBody');if(!tbody)return;
    if(!users.length){tbody.innerHTML='<tr><td colspan="6">Aucun utilisateur ne correspond aux filtres.</td></tr>';return;}
    tbody.innerHTML=users.map(user=>`<tr><td><div class="user-cell"><div class="avatar">${escapeHtml(String(user.fullName||'?').split(/\s+/).slice(0,2).map(p=>p[0]||'').join('').toUpperCase())}</div><div class="user-info"><div class="name">${escapeHtml(user.fullName)}</div><div class="email">${escapeHtml(user.username)} · ${escapeHtml(user.email)}</div></div></div></td>
      <td>${escapeHtml(user.department)}</td><td><span class="badge-role" style="font-size:.7rem">${escapeHtml(user.role).toUpperCase()}</span></td><td>${escapeHtml(user.phone||'—')}</td>
      <td><span class="status-badge ${Number(user.isActive)?'status-active':'status-suspended'}">${Number(user.isActive)?'Actif':'Désactivé'}</span></td>
      <td><div class="actions-cell"><button class="btn btn-secondary btn-sm" onclick="editUser('${escapeHtml(user.id)}')" title="Modifier">✏️</button><button class="btn btn-secondary btn-sm" onclick="resetUserPassword('${escapeHtml(user.id)}')" title="Réinitialiser le mot de passe">🔑</button><button class="btn ${Number(user.isActive)?'btn-danger':'btn-secondary'} btn-sm" onclick="toggleUserStatus('${escapeHtml(user.id)}')" title="${Number(user.isActive)?'Désactiver':'Réactiver'}">${Number(user.isActive)?'Désactiver':'Réactiver'}</button></div></td></tr>`).join('');
  }

  function filterUsers(){clearTimeout(userSearchTimer);userSearchTimer=setTimeout(loadUsers,200);}
  function openUserModal(isEdit=false){
    $('userForm').reset();$('userId').value='';$('userPassword').required=!isEdit;$('userPasswordGroup').hidden=isEdit;
    $('modalUserTitle').textContent=isEdit?'Modifier l’utilisateur':'Créer un utilisateur';$('userModal').classList.add('open');
  }
  function closeUserModal(){$('userModal').classList.remove('open');$('userForm').reset();}
  async function editUser(id){
    const user=users.find(item=>String(item.id)===String(id));if(!user)return;
    openUserModal(true);$('userId').value=user.id;$('userFullName').value=user.fullName;$('userUsername').value=user.username;$('userEmail').value=user.email;$('userPhone').value=user.phone||'';$('userJobTitle').value=user.jobTitle||'';$('userDept').value=user.department;$('userRole').value=normalizeRole(user.role);
  }
  const normalizeRole=role=>String(role||'').toLowerCase()==='manager'?'chef_service':String(role||'').toLowerCase();
  async function saveUser(event){
    event.preventDefault();const id=$('userId').value;
    const payload={fullName:$('userFullName').value.trim(),username:$('userUsername').value.trim(),email:$('userEmail').value.trim(),phone:$('userPhone').value.trim(),jobTitle:$('userJobTitle').value.trim(),department:$('userDept').value,role:$('userRole').value,password:$('userPassword').value};
    try{await request(id?`/users/${encodeURIComponent(id)}`:'/users',{method:id?'PUT':'POST',body:JSON.stringify(payload)});closeUserModal();toast(id?'Utilisateur modifié.':'Compte créé.');await Promise.all([loadUsers(),loadOverview(),loadDepartments()]);}
    catch(error){toast(error.message);}
  }
  async function toggleUserStatus(id){
    const user=users.find(item=>String(item.id)===String(id));if(!user)return;
    const active=!Number(user.isActive);if(!confirm(`${active?'Réactiver':'Désactiver'} le compte de ${user.fullName} ?`))return;
    try{await request(`/users/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({active})});toast('Statut du compte mis à jour.');await Promise.all([loadUsers(),loadOverview()]);}catch(error){toast(error.message);}
  }
  async function resetUserPassword(id){
    const user=users.find(item=>String(item.id)===String(id));if(!user)return;
    const password=prompt(`Saisissez un mot de passe temporaire pour ${user.fullName} (10 caractères minimum).`);
    if(password===null)return;
    try{const data=await request(`/users/${encodeURIComponent(id)}/reset-password`,{method:'POST',body:JSON.stringify({password})});toast(data.message||'Mot de passe réinitialisé.');}
    catch(error){toast(error.message);}
  }

  function openDeptModal(){ $('departmentForm').reset();$('departmentId').value='';$('departmentModalTitle').textContent='Créer un département';$('departmentModal').classList.add('open'); }
  function closeDepartmentModal(){$('departmentModal').classList.remove('open');$('departmentForm').reset();}
  function editDepartment(id){const item=departments.find(d=>String(d.id)===String(id));if(!item)return;$('departmentId').value=item.id;$('departmentName').value=item.name;$('departmentModalTitle').textContent='Modifier le département';$('departmentModal').classList.add('open');}
  async function saveDepartment(event){event.preventDefault();const id=$('departmentId').value;try{await request(id?`/departments/${encodeURIComponent(id)}`:'/departments',{method:id?'PUT':'POST',body:JSON.stringify({name:$('departmentName').value.trim(),active:true})});closeDepartmentModal();toast('Département enregistré.');await Promise.all([loadDepartments(),loadOverview()]);}catch(error){toast(error.message);}}
  async function setDepartmentActive(id,active){const item=departments.find(d=>String(d.id)===String(id));if(!item)return;if(!confirm(`${active?'Réactiver':'Désactiver'} le département ${item.name} ?`))return;try{await request(`/departments/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({name:item.name,active})});toast('Département mis à jour.');await Promise.all([loadDepartments(),loadOverview()]);}catch(error){toast(error.message);}}
  async function deleteDepartment(id){
    const item=departments.find(d=>String(d.id)===String(id));if(!item)return;
    const members=Number(item.memberCount||0);
    const target=departments.filter(d=>String(d.id)!==String(id)&&Number(d.isActive)!==0).sort((a,b)=>a.name.localeCompare(b.name,'fr'))[0];
    if(members&&!target){toast('Aucun autre département actif ne peut accueillir les membres.');return;}
    const reassignment=members?`${members} compte(s), actifs ou désactivés, seront réaffectés à « ${target.name} ».`:'Aucun compte n’est rattaché à ce département.';
    if(!confirm(`Supprimer définitivement « ${item.name} » ? ${reassignment} Cette action est irréversible.`))return;
    try{const result=await request(`/departments/${encodeURIComponent(id)}`,{method:'DELETE'});toast(result.reassignedUsers?`${result.reassignedUsers} compte(s) transféré(s) vers ${result.targetDepartment}. Département supprimé.`:'Département supprimé.');await Promise.all([loadDepartments(),loadOverview(),loadUsers()]);}
    catch(error){toast(error.message);}
  }

  async function loadReports(){
    const params=new URLSearchParams();
    const filters={search:$('reportSearch')?.value.trim(),department:$('reportDepartmentFilter')?.value,status:$('reportStatusFilter')?.value,dateFrom:$('reportDateFrom')?.value,dateTo:$('reportDateTo')?.value};
    Object.entries(filters).forEach(([key,value])=>{if(value)params.set(key,value);});
    const body=$('reportsTableBody');if(!body)return;body.innerHTML='<tr><td colspan="7">Chargement…</td></tr>';
    const kind=$('reportDataType')?.value||'reports';
    if($('reportStatusFilter'))$('reportStatusFilter').disabled=kind==='ratings';
    const head=$('adminReviewHead');
    try{
      if(kind==='reports'){
        if(head)head.innerHTML='<tr><th>Date</th><th>Agent</th><th>Département</th><th>Activités</th><th>Durée</th><th>Statut</th><th>Commentaires</th></tr>';
        const data=await request(`/reports?${params}`);const rows=data.reports||[];
        body.innerHTML=rows.length?rows.map(r=>`<tr><td>${escapeHtml(formatDate(r.reportDate))}</td><td><strong>${escapeHtml(r.agentName)}</strong><small style="display:block;color:var(--text-muted)">${escapeHtml(r.username)}</small></td><td>${escapeHtml(r.department)}</td><td>${Number(r.completedActivities||0)} / ${Number(r.activityCount||0)} terminées</td><td>${Number(r.totalHours||0).toFixed(1)} h</td><td><span class="status-badge ${statusClass(r.status)}">${escapeHtml(statusLabel(r.status))}</span></td><td>${escapeHtml(r.comments||'—')}</td></tr>`).join(''):'<tr><td colspan="7">Aucun rapport pour ces critères.</td></tr>';
      }else{
        if(kind==='proposals'&&filters.status)params.set('status',filters.status);
        params.set('type',kind);
        if(head)head.innerHTML=kind==='ratings'?'<tr><th>Date</th><th>Agent</th><th>Département</th><th>Note</th><th>Avis</th><th>Évalué par</th></tr>':'<tr><th>Date</th><th>Agent</th><th>Département</th><th>Activité</th><th>Proposition</th><th>Statut</th><th>Avis du chef</th></tr>';
        const data=await request(`/reviews?${params}`);const rows=data.rows||[];
        body.innerHTML=rows.length?rows.map(r=>kind==='ratings'?`<tr><td>${escapeHtml(formatDate(r.date))}</td><td><strong>${escapeHtml(r.agentName)}</strong><small style="display:block;color:var(--text-muted)">${escapeHtml(r.username)}</small></td><td>${escapeHtml(r.department)}</td><td><strong>${Number(r.rating)}/5</strong></td><td>${escapeHtml(r.details||'—')}</td><td>${escapeHtml(r.reviewer||'—')}</td></tr>`:`<tr><td>${escapeHtml(formatDate(r.date))}</td><td><strong>${escapeHtml(r.agentName)}</strong><small style="display:block;color:var(--text-muted)">${escapeHtml(r.username)}</small></td><td>${escapeHtml(r.department)}</td><td>${escapeHtml(r.activityDescription||'—')}</td><td>${escapeHtml(r.details||'—')}</td><td><span class="status-badge ${statusClass(r.status)}">${escapeHtml(statusLabel(r.status))}</span></td><td>${escapeHtml(r.reviewComment||'—')}</td></tr>`).join(''):`<tr><td colspan="7">Aucune donnée pour ces critères.</td></tr>`;
      }
    }catch(error){body.innerHTML=`<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;}
  }
  function statusLabel(status){const value=String(status||'').toLowerCase();return ({submitted:'Soumis',pending:'En attente',approved:'Approuvé',validated:'Approuvé',rejected:'Rejeté'})[value]||status||'—';}
  function statusClass(status){const value=String(status||'').toLowerCase();return ['approved','validated'].includes(value)?'status-active':['rejected'].includes(value)?'status-locked':'status-suspended';}
  function formatDate(value){if(!value)return'—';const date=String(value).slice(0,10).split('-');return date.length===3?`${date[2]}/${date[1]}/${date[0]}`:String(value);}

  async function loadLogs(){const body=$('logsTableBody');if(!body)return;body.innerHTML='<tr><td colspan="5">Chargement du journal…</td></tr>';try{const data=await request('/audit-logs');const rows=data.logs||[];body.innerHTML=rows.length?rows.map(log=>`<tr><td>${escapeHtml(new Date(log.createdAt).toLocaleString('fr-FR'))}</td><td><strong>${escapeHtml(log.actorName||log.actorEmail||'Administrateur')}</strong></td><td><code class="log-event">${escapeHtml(log.action)}</code></td><td class="log-ip">${escapeHtml(log.ipAddress||'—')}</td><td>${escapeHtml(log.details||'')}</td></tr>`).join(''):'<tr><td colspan="5">Aucune action administrative journalisée.</td></tr>';}catch(error){body.innerHTML=`<tr><td colspan="5">${escapeHtml(error.message)}</td></tr>`;}}
  async function loadRetention(){
    try{const data=await request('/retention');(data.policies||[]).forEach(policy=>{if(policy.entityType==='daily_report'){$('retentionReportsEnabled').checked=Number(policy.isEnabled)===1;$('retentionReportsDays').value=policy.retentionDays;}if(policy.entityType==='report_issue'){$('retentionProposalsEnabled').checked=Number(policy.isEnabled)===1;$('retentionProposalsDays').value=policy.retentionDays;}if(policy.entityType==='notation'){$('retentionRatingsEnabled').checked=Number(policy.isEnabled)===1;$('retentionRatingsDays').value=policy.retentionDays;}});}
    catch(error){toast(error.message);}
  }
  async function saveRetention(event){
    event.preventDefault();
    const policies=[{entityType:'daily_report',retentionDays:Number($('retentionReportsDays').value),enabled:$('retentionReportsEnabled').checked},{entityType:'report_issue',retentionDays:Number($('retentionProposalsDays').value),enabled:$('retentionProposalsEnabled').checked},{entityType:'notation',retentionDays:Number($('retentionRatingsDays').value),enabled:$('retentionRatingsEnabled').checked}];
    try{await request('/retention',{method:'PUT',body:JSON.stringify({policies})});toast('Règles de conservation enregistrées.');}
    catch(error){toast(error.message);}
  }
  async function runArchive(){
    if(!confirm('Lancer l’archivage des rapports et notations qui dépassent leur durée de conservation ? Les originaux resteront dans les tables actives.'))return;
    const button=$('runArchiveButton');if(button)button.disabled=true;
    try{const data=await request('/archives/run',{method:'POST',body:JSON.stringify({})});const reports=Number(data.archived?.daily_report||0),proposals=Number(data.archived?.report_issue||0),ratings=Number(data.archived?.notation||0),left=(data.remaining||[]).reduce((sum,row)=>sum+Number(row.total||0),0);toast(`${reports} rapport(s), ${proposals} proposition(s) et ${ratings} notation(s) archivés.${left?` ${left} élément(s) restent à traiter ; relancez l’opération.`:''}`);await loadArchives();}
    catch(error){toast(error.message);}
    finally{if(button)button.disabled=false;}
  }
  async function loadArchives(){
    const body=$('archivesTableBody');if(!body)return;body.innerHTML='<tr><td colspan="6">Chargement des archives…</td></tr>';
    try{const data=await request('/archives');const rows=data.archives||[];body.innerHTML=rows.length?rows.map(item=>`<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(formatDate(item.recordDate))}</td><td>${escapeHtml(item.department||'—')}</td><td>${escapeHtml(item.ownerName||item.ownerId||'—')}</td><td>${escapeHtml(new Date(item.archivedAt).toLocaleString('fr-FR'))}</td><td><button class="btn btn-secondary btn-sm" onclick="viewArchive('${Number(item.id)}')">Voir</button></td></tr>`).join(''):'<tr><td colspan="6">Aucune donnée archivée pour le moment.</td></tr>';}
    catch(error){body.innerHTML=`<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`;}
  }
  async function viewArchive(id){
    try{const data=await request(`/archives/${encodeURIComponent(id)}`);$('archiveDetailsContent').textContent=JSON.stringify(data.archive?.payload??{},null,2);$('archiveDetailsModal').classList.add('open');}
    catch(error){toast(error.message);}
  }
  function closeArchiveDetails(){$('archiveDetailsModal')?.classList.remove('open');}
  function switchTab(tab){document.querySelectorAll('.tab-btn').forEach(button=>button.classList.remove('active'));document.querySelectorAll('.section-content').forEach(section=>section.classList.remove('active'));const sectionId=tab==='reports'?'tab-reports':`tab-${tab}`;$(sectionId)?.classList.add('active');document.querySelectorAll('.tab-btn').forEach(button=>{if(button.getAttribute('onclick')?.includes(`'${tab}'`))button.classList.add('active');});if(tab==='reports')loadReports();if(tab==='logs')loadLogs();if(tab==='retention'){loadRetention();loadArchives();}}
  function toggleTheme(){const root=document.documentElement;root.setAttribute('data-theme',root.getAttribute('data-theme')==='dark'?'light':'dark');}
  function logout(){localStorage.removeItem('token');localStorage.removeItem('authToken');localStorage.removeItem('userId');window.location.href='D_auth.html';}

  Object.assign(window,{switchTab,loadReports,loadLogs,loadArchives,viewArchive,closeArchiveDetails,openUserModal,closeUserModal,editUser,saveUser,toggleUserStatus,resetUserPassword,filterUsers,openDeptModal,editDepartment,saveDepartment,closeDepartmentModal,deactivateDepartment:id=>setDepartmentActive(id,false),activateDepartment:id=>setDepartmentActive(id,true),deleteDepartment,toggleTheme,logout});
  window.onload = async()=>{
    if(!localStorage.getItem('token')&&!localStorage.getItem('authToken')){window.location.href='D_auth.html';return;}
    try{await loadDepartments();populateDepartments();await Promise.all([loadOverview(),loadUsers()]);}
    catch(error){toast(error.message);}
    $('userSearch')?.addEventListener('input',filterUsers);
    ['roleFilter','deptFilter','statusFilter'].forEach(id=>$(id)?.addEventListener('change',loadUsers));
    $('userForm')?.addEventListener('submit',saveUser);
    $('departmentForm')?.addEventListener('submit',saveDepartment);
    $('retentionForm')?.addEventListener('submit',saveRetention);
    $('runArchiveButton')?.addEventListener('click',runArchive);
    $('reportSearch')?.addEventListener('input',()=>{clearTimeout(reportSearchTimer);reportSearchTimer=setTimeout(loadReports,250);});
    $('reportDataType')?.addEventListener('change',()=>{
      const filter=$('reportStatusFilter');
      if(filter){const kind=$('reportDataType').value;filter.innerHTML=kind==='proposals'?'<option value="">Tous les statuts</option><option value="pending">En attente</option><option value="approved">Approuvée</option><option value="rejected">Rejetée</option>':kind==='ratings'?'<option value="">Sans filtre de statut</option>':'<option value="">Tous les statuts</option><option value="submitted">Soumis</option><option value="approved">Approuvé</option><option value="rejected">Rejeté</option><option value="pending">En attente</option>';}
      loadReports();
    });
    ['reportDepartmentFilter','reportStatusFilter','reportDateFrom','reportDateTo'].forEach(id=>$(id)?.addEventListener('change',loadReports));
  };
})();
