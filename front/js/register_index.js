document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginIdentity = document.getElementById('loginIdentity');
    const passwordInput = document.getElementById('password');
    const togglePasswordBtn = document.querySelector('.toggle-password-btn');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const demoBadge = document.querySelector('.demo-badge');
    const toastContainer = document.getElementById('toastContainer');

    // --- 1. Afficher / Masquer le mot de passe ---
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', () => {
            const eyeOpen = togglePasswordBtn.querySelector('.icon-eye-open');
            const eyeClosed = togglePasswordBtn.querySelector('.icon-eye-closed');
            const isPassword = passwordInput.getAttribute('type') === 'password';

            passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
            if (eyeOpen) eyeOpen.style.display = isPassword ? 'none' : 'block';
            if (eyeClosed) eyeClosed.style.display = isPassword ? 'block' : 'none';    
        });
    }

    // --- 2. Bascule du Thème Clair / Sombre ---
    if (themeToggleBtn) {
        const currentTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', currentTheme);
        themeToggleBtn.textContent = currentTheme === 'dark' ? '☀️' : '🌙';

        themeToggleBtn.addEventListener('click', () => {
            const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            themeToggleBtn.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        });
    }

    // --- 3. Remplissage rapide via le badge Démo ---
    if (demoBadge && loginIdentity && passwordInput) {
        demoBadge.style.cursor = 'pointer';
        demoBadge.addEventListener('click', () => {
            loginIdentity.value = 'demo';
            passwordInput.value = 'password123';
            showToast('Identifiants de démo remplis !', 'info');
        });
    }

    // --- 4. Envoi du Formulaire de Connexion ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const identity = loginIdentity.value.trim();
            const password = passwordInput.value;
            const rememberMe = document.getElementById('rememberMe')?.checked || false;

            if (!identity || !password) {
                showToast('Veuillez remplir tous les champs obligatoires.', 'error');
                return;
            }

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identity, password, rememberMe })
                });

                const data = await response.json();

                if (!response.ok) {
                    showToast(data.message || 'Identifiants incorrects.', 'error');
                    return;
                }

                // --- CAS A : Validation 2FA requise ---
                if (data.requires2FA) {
                    // Stockage des identifiants temporaires pour la validation 2FA
                    if (data.userId) sessionStorage.setItem('tempUserId', data.userId);
                    if (data.tempToken) sessionStorage.setItem('tempToken', data.tempToken);

                    showToast('Code de sécurité envoyé ! Redirection...', 'success');

                    const queryParams = new URLSearchParams();
                    if (data.userId) queryParams.append('user_id', data.userId);
                    if (data.username) queryParams.append('username', data.username);

                    // 1. Voir le Token JWT définitif (en connexion directe)

// 2. Voir le Token temporaire 2FA (si redirigé vers D_auth.html)

                    setTimeout(() => {
                        window.location.href = `D_auth.html?${queryParams.toString()}`;
                    }, 1000);
                    return;
                }

                // --- CAS B : Connexion directe (Sans 2FA) ---
                showToast('Connexion réussie ! Redirection...', 'success');

                // Initialisation et stockage du token JWT sous toutes les clés utilisées par l'application
                if (data.token) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('authToken', data.token);
                    if (data.userId) localStorage.setItem('userId', data.userId);
                }

                // Détermination de la page de destination selon le rôle
                const roleClean = String(data.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
                let redirectUrl = '../html/admin_dashboard.html';

                if (roleClean === 'agent') {
                    redirectUrl = `../html/Stat_dashb.html?username=${encodeURIComponent(data.username || '')}&user_id=${encodeURIComponent(data.userId || '')}`;
                } else if (roleClean === 'chef_de_service' || roleClean === 'chef_service' || roleClean === 'chef') {
                    redirectUrl = `../html/chef_service_dashboard.html?username=${encodeURIComponent(data.username || '')}&user_id=${data.userId || ''}`;
                }

                setTimeout(() => {
                    window.location.href = redirectUrl;
                }, 1200);

            } catch (err) {
                console.error('Erreur lors du login:', err);
                showToast('Erreur serveur lors de la connexion.', 'error');
            }
        });
    }

    // --- Helper Notification Toast ---
    function showToast(message, type = 'info') {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.style.cssText = `
            padding: 12px 20px;
            margin-top: 8px;
            border-radius: 6px;
            color: #fff;
            background: ${type === 'error' ? '#e74c3c' : type === 'success' ? '#2ecc71' : '#3498db'};
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            transition: opacity 0.3s ease;
        `;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
});
