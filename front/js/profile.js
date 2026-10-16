document.addEventListener('DOMContentLoaded', () => {
  /* ==========================================================================
     1. GESTION DES PARAMÈTRES, DU TOKEN ET DU LIEN DE RETOUR
     ========================================================================== */
  const linkProfile = document.getElementById('retour');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const urlParams = new URLSearchParams(window.location.search);
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');

  const userId = urlParams.get('user_id') || user.id || user.user_id || localStorage.getItem('userId');
  const username = urlParams.get('username') || user.username || localStorage.getItem('username') || '';

  // Helper pour générer les headers JSON sécurisés avec le token JWT
  function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  // Intercepteur d'expiration de session
  function handleAuthError(response) {
    if (response.status === 401) {
      showToast('Votre session a expiré. Veuillez vous reconnecter.', 'error');
      setTimeout(() => window.location.href = '/index.html', 1500);
      return true;
    }
    return false;
  }

  let departmentColleagues = [];

  function renderDepartmentColleagues(search = '') {
    const list = document.getElementById('departmentColleaguesList');
    if (!list) return;
    const query = search.trim().toLocaleLowerCase('fr');
    const filtered = departmentColleagues.filter(person =>
      [person.name, person.username, person.email, person.jobTitle, person.role]
        .some(value => String(value || '').toLocaleLowerCase('fr').includes(query))
    );
    const count = document.getElementById('directoryCount');
    if (count) count.textContent = `${filtered.length} ${filtered.length === 1 ? 'personne' : 'personnes'}`;
    if (!filtered.length) {
      list.innerHTML = `<p class="directory-empty">${departmentColleagues.length ? 'Aucun résultat pour cette recherche.' : 'Aucun membre actif trouvé dans ce département.'}</p>`;
      return;
    }
    list.replaceChildren(...filtered.map(person => {
      const card = document.createElement('article');
      card.className = 'directory-person';
      const avatar = document.createElement('div');
      avatar.className = 'directory-avatar';
      if (person.avatarUrl) {
        const image = document.createElement('img');
        image.src = person.avatarUrl;
        image.alt = '';
        avatar.appendChild(image);
      } else {
        avatar.textContent = String(person.name || person.username || '?').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
      }
      const details = document.createElement('div');
      details.className = 'directory-person-details';
      const name = document.createElement('strong');
      name.textContent = person.name || person.username || 'Utilisateur';
      const job = document.createElement('span');
      job.textContent = person.jobTitle || (person.role === 'agent' ? 'Agent' : 'Chef de service');
      const contact = document.createElement('a');
      contact.href = `mailto:${person.email || ''}`;
      contact.textContent = person.email || 'Adresse email non renseignée';
      const phone = document.createElement('a');
      phone.className = 'directory-phone';
      phone.href = person.phone ? `tel:${String(person.phone).replace(/[^\d+]/g, '')}` : '#';
      phone.textContent = person.phone || 'Téléphone non renseigné';
      if (!person.phone) phone.removeAttribute('href');
      details.append(name, job, contact, phone);
      card.append(avatar, details);
      return card;
    }));
  }

  async function loadDepartmentColleagues() {
    const section = document.getElementById('departmentColleaguesSection');
    const list = document.getElementById('departmentColleaguesList');
    if (!section || !list) return;
    list.innerHTML = '<p class="directory-empty">Chargement de la liste…</p>';
    try {
      const response = await fetch('/api/auth/department/colleagues', { headers: getAuthHeaders() });
      if (handleAuthError(response)) return;
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || `Erreur HTTP ${response.status}`);
      departmentColleagues = result.colleagues || [];
      section.hidden = false;
      const chefView = result.audience === 'agents';
      document.getElementById('directoryDepartment').textContent = result.department || 'Mon département';
      document.getElementById('directoryTitle').textContent = chefView ? 'Agents du département' : 'Chefs de service du département';
      document.getElementById('directoryDescription').textContent = chefView
        ? 'Agents actifs rattachés à votre département'
        : 'Chefs de service actifs que vous pouvez contacter';
      renderDepartmentColleagues(document.getElementById('directorySearch')?.value || '');
    } catch (error) {
      console.error('Erreur chargement de l’annuaire du département :', error);
      section.hidden = false;
      list.innerHTML = '<p class="directory-empty">Impossible de charger la liste du département.</p>';
    }
  }

  document.getElementById('directorySearch')?.addEventListener('input', event => renderDepartmentColleagues(event.target.value));

  if (linkProfile && userId) {
    linkProfile.href = `../html/Stat_dashb.html?username=${encodeURIComponent(username)}&user_id=${encodeURIComponent(userId)}`;
  }

  /* ==========================================================================
     2. GESTION DU THÈME SOMBRE / CLAIR
     ========================================================================== */
  const themeToggleBtn = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');

  function initTheme() {
    const savedTheme = localStorage.getItem('app_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', newTheme);
      localStorage.setItem('app_theme', newTheme);
      updateThemeIcon(newTheme);
    });
  }

  function updateThemeIcon(theme) {
    if (!themeIcon) return;
    if (theme === 'dark') {
      themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
    } else {
      themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>`;
    }
  }

  /* ==========================================================================
     3. CHARGEMENT DU PROFIL DEPUIS L'API BACKEND
     ========================================================================== */
  async function loadProfile(id) {
    if (!id) {
      showToast('❌ Aucun identifiant utilisateur trouvé.', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/auth/getprofile?user_id=${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: getAuthHeaders()
      });

      if (handleAuthError(response)) return;

      if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status}`);
      }

      const result = await response.json();

      if (!result.success || !result.user) {
        showToast(result.message || 'Impossible de charger le profil.', 'error');
        return;
      }

      const userData = result.user;
      await loadDepartmentColleagues();
      const normalizedRole = String(userData.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
      const isServiceChief = ['manager', 'chef_service', 'chef_de_service', 'chef'].includes(normalizedRole);
      if (linkProfile) {
        linkProfile.href = isServiceChief
          ? '../html/chef_service_dashboard.html'
          : `../html/Stat_dashb.html?username=${encodeURIComponent(userData.username || username)}&user_id=${encodeURIComponent(userData.id || userId)}`;
      }

      // --- Mise à jour de la Sidebar ---
      const avatarPreview = document.getElementById('avatarPreview');
      const sidebarFullname = document.getElementById('sidebarFullname');
      const sidebarUsername = document.getElementById('sidebarUsername');
      const sidebarRole = document.getElementById('sidebarRole');

      if (avatarPreview && userData.avatar_url) avatarPreview.src = userData.avatar_url;
      if (sidebarFullname) sidebarFullname.textContent = `${userData.last_name || 'Agent'}`;
      if (sidebarUsername) sidebarUsername.textContent = `@${userData.username || 'agent'}`;

      if (sidebarRole) {
        if (isServiceChief) {
          sidebarRole.textContent = 'Chef de Service';
          sidebarRole.classList.add('manager');
        } else {
          sidebarRole.textContent = userData.role || 'Agent du Service';
          sidebarRole.classList.remove('manager');
        }
      }

      // --- Mise à jour des Formulaires ---
      if (document.getElementById('firstName')) document.getElementById('firstName').value = userData.first_name || '';
      if (document.getElementById('lastName')) document.getElementById('lastName').value = userData.last_name || '';
      if (document.getElementById('email')) document.getElementById('email').value = userData.email || '';
      if (document.getElementById('phone')) document.getElementById('phone').value = userData.phone || '';
      if (document.getElementById('department')) document.getElementById('department').value = userData.department || '';
      if (document.getElementById('jobTitle')) document.getElementById('jobTitle').value = userData.job_title || '';
      if (document.getElementById('bio')) document.getElementById('bio').value = userData.bio || '';

      console.log('✅ Profil chargé avec succès pour :', userData.username);

    } catch (error) {
      console.error('❌ Erreur lors du chargement du profil :', error);
      showToast('Erreur de connexion lors du chargement du profil.', 'error');
    }
  }

  /* ==========================================================================
     4. SOUMISSION DES FORMULAIRES ET FICHIERS
     ========================================================================== */

  // Upload photo d'avatar
  const avatarUploadInput = document.getElementById('avatarUpload');
  if (avatarUploadInput) {
    avatarUploadInput.addEventListener('change', async function (e) {
      const file = e.target.files[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        showToast('Veuillez sélectionner un fichier image valide.', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('user_id', userId);
      formData.append('avatar', file);

      // Pour les fichiers, fetch s'occupe du Content-Type (multipart), mais on ajoute le token Authorization
      const customHeaders = {};
      if (token) customHeaders['Authorization'] = `Bearer ${token}`;

      try {
        const response = await fetch('/api/auth/charge-avatar', {
          method: 'POST',
          headers: customHeaders,
          body: formData
        });

        if (handleAuthError(response)) return;

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Erreur lors de l\'envoi de l\'image.');
        }

        const avatarPreview = document.getElementById('avatarPreview');
        if (avatarPreview && result.avatar_url) {
          avatarPreview.src = `${result.avatar_url}?t=${new Date().getTime()}`;
        }

        showToast('Photo de profil enregistrée avec succès !', 'success');

      } catch (error) {
        console.error('❌ Erreur upload avatar :', error);
        showToast(error.message || 'Erreur lors de la sauvegarde de la photo.', 'error');
      }
    });
  }

  // Soumission des informations personnelles
  const profileForm = document.getElementById('profileForm');
  if (profileForm) {
    profileForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const submitBtn = profileForm.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn ? submitBtn.innerHTML : '';

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = 'Enregistrement...';
        }

        const updatedData = {
          user_id: userId,
          last_name: document.getElementById('lastName')?.value || '',
          email: document.getElementById('email')?.value || '',
          phone: document.getElementById('phone')?.value || '',
          department: document.getElementById('department')?.value || '',
          jobtitle: document.getElementById('jobTitle')?.value || '',
          bio: document.getElementById('bio')?.value || '',
          avatar_url: document.getElementById('avatarPreview')?.src || ''
        };

        const response = await fetch('/api/auth/profile', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(updatedData)
        });

        if (handleAuthError(response)) return;

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Erreur lors de la mise à jour');
        }

        const sidebarFullname = document.getElementById('sidebarFullname');
        if (sidebarFullname) {
          sidebarFullname.textContent = updatedData.last_name;
        }

        showToast(result.message || 'Informations de profil enregistrées avec succès !', 'success');

      } catch (error) {
        console.error('❌ Erreur mise à jour profil :', error);
        showToast(error.message || 'Erreur lors de l\'enregistrement des modifications.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnText;
        }
      }
    });
  }

  // Soumission du changement de mot de passe
  const passwordForm = document.getElementById('passwordForm');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (newPassword !== confirmPassword) {
        showToast('Les nouveaux mots de passe ne correspondent pas.', 'error');
        return;
      }

      if (newPassword.length < 12) {
        showToast('Le nouveau mot de passe doit contenir au moins 12 caractères.', 'error');
        return;
      }

      const submitBtn = passwordForm.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn ? submitBtn.innerHTML : '';

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = 'Mise à jour...';
        }

        const response = await fetch('/api/auth/change-password', {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            user_id: userId,
            currentPassword,
            newPassword
          })
        });

        if (handleAuthError(response)) return;

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Erreur lors du changement de mot de passe');
        }

        showToast(result.message || 'Mot de passe modifié avec succès !', 'success');
        passwordForm.reset();

      } catch (error) {
        console.error('❌ Erreur changement mot de passe :', error);
        showToast(error.message || 'Erreur lors du changement de mot de passe.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnText;
        }
      }
    });
  }

  // Initialisations au chargement
  initTheme();
  loadProfile(userId);
});

/* ==========================================================================
   5. FONCTIONS GLOBALES (Accessibles via onclick dans le HTML)
   ========================================================================== */

window.switchTab = function (tabId, element) {
  if (!tabId) return;

  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add('active');
  if (element) element.classList.add('active');
};

window.selectPresetAvatar = function (src) {
  const avatarPreview = document.getElementById('avatarPreview');
  if (avatarPreview) {
    avatarPreview.src = src;
    showToast('Avatar mis à jour !', 'success');
  }
};

window.togglePassword = function (inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
};

window.showToast = function (message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const isSuccess = type === 'success';
  const color = isSuccess ? '#10b981' : '#ef4444';

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2">
      <path d="${isSuccess ? 'M22 11.08V12a10 10 0 1 1-5.93-9.14' : 'M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'}"></path>
      ${isSuccess ? '<polyline points="22 4 12 14.01 9 11.01"></polyline>' : ''}
    </svg>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
};

async function fetchUserAvatar(userId) {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const response = await fetch(`/api/auth/get-avatar?user_id=${encodeURIComponent(userId)}`, { headers });
    const result = await response.json();

    if (result.success && result.avatar_url) {
      const avatarPreview = document.getElementById('avatarPreview');
      if (avatarPreview) {
        avatarPreview.src = result.avatar_url;
      }
    }
  } catch (error) {
    console.error('❌ Erreur lors du chargement de l\'avatar :', error);
  }
}
