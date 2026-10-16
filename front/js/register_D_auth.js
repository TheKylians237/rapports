document.addEventListener('DOMContentLoaded', () => {
    const inputs = document.querySelectorAll('.otp-input');
    const otpForm = document.getElementById('otpForm');
    let timerVal = 30;
    let timerInterval = null;

    // --- 1. Fonctions globales (onclick) ---
    window.toggleTheme = function () {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
    };
    window.resendCode = async function () {
        const userId = sessionStorage.getItem('tempUserId');
        const preAuthToken = sessionStorage.getItem('tempToken');
        if (!userId || !preAuthToken) {
            showToast('Session expirée. Veuillez vous reconnecter.', 'error');
            return;
        }
        try {
            const response = await fetch('/api/auth/resend-2fa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, preAuthToken })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message || 'Impossible de renvoyer le code.');
            showToast(data.message, 'success');
            window.startTimer();
        } catch (error) {
            showToast(error.message || 'Impossible de contacter le serveur.', 'error');
        }
    };

    window.useBackupCode = function () {
        const code = prompt("Veuillez saisir l'un de vos codes de secours à 10 caractères :");
        const preAuthToken = sessionStorage.getItem('tempToken');
        if (!code || !preAuthToken) return;
        fetch('/api/auth/validate-2FA', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preAuthToken, otpCode: code.trim() })
        }).then(async response => {
            const data = await response.json();
            if (!response.ok || !data.token) throw new Error(data.message || 'Code de secours invalide.');
            localStorage.setItem('token', data.token);
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('userId', data.user.userId);
            sessionStorage.removeItem('tempToken');
            sessionStorage.removeItem('tempUserId');
            showToast('Connexion réussie.', 'success');
            const role = String(data.user.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            const target = role === 'agent'
                ? `/html/Stat_dashb.html?username=${encodeURIComponent(data.user.username || '')}&user_id=${encodeURIComponent(data.user.userId)}`
                : ['chef_service', 'chef_de_service', 'chef', 'manager'].includes(role)
                    ? '/html/chef_service_dashboard.html'
                    : '/html/admin_dashboard.html';
            setTimeout(() => window.location.href = target, 1000);
        }).catch(error => showToast(error.message || 'Erreur de connexion.', 'error'));
    };

    // --- 2. Minuteur de renvoi ---
    window.startTimer = function () {
        timerVal = 30;
        const resendBtn = document.getElementById('resendBtn');
        const timerSpan = document.getElementById('timer');
        if (!resendBtn || !timerSpan) return;

        resendBtn.disabled = true;
        timerSpan.textContent = timerVal;
        resendBtn.innerHTML = `Renvoyer le code (<span id="timer">${timerVal}</span>s)`;

        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            timerVal--;
            const currentTimerSpan = document.getElementById('timer');
            if (currentTimerSpan) currentTimerSpan.textContent = timerVal;

            if (timerVal <= 0) {
                clearInterval(timerInterval);
                resendBtn.disabled = false;
                resendBtn.innerHTML = "Renvoyer le code";
            }
        }, 1000);
    };

    // --- 3. Soumission du formulaire OTP ---
    if (otpForm) {
        otpForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const code = Array.from(inputs).map(i => i.value).join('');
            const userId = sessionStorage.getItem('tempUserId');

            if (!userId) {
                showToast("Session expirée. Veuillez vous reconnecter.", "error");
                setTimeout(() => window.location.href = '/index.html', 1500);
                return;
            }

            if (code.length !== 6) {
                showToast("Veuillez saisir les 6 chiffres du code.", "error");
                return;
            }

            try {
                const response = await fetch('/api/auth/verify-2fa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, code })
                });

                const data = await response.json();

                if (response.ok && (data.success || data.token)) {
                    if (data.token) {
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('authToken', data.token);
                        if (data.userId) localStorage.setItem('userId', data.userId);
                    }
                    sessionStorage.removeItem('tempUserId');
                    showToast("Connexion réussie !", "success");

                    // Normalisation du rôle en minuscules
                    const roleClean = String(data.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

                    let redirectUrl = '../html/admin_dashboard.html';

                    if (roleClean === 'agent') {
                        redirectUrl = `../html/Stat_dashb.html?username=${encodeURIComponent(data.username || '')}&user_id=${encodeURIComponent(data.userId || '')}`;
                        // Dans D_auth.js (après la réussite de verify2FA) :
sessionStorage.removeItem('tempToken');
sessionStorage.removeItem('tempUserId');
localStorage.removeItem('tempToken');
                    } else if (roleClean === 'chef_de_service' || roleClean === 'chef_service' || roleClean === 'chef' || roleClean === 'manager') {
                        redirectUrl = `../html/chef_service_dashboard.html?username=${encodeURIComponent(data.username || '')}&user_id=${data.userId || ''}`;
                        // Dans D_auth.js (après la réussite de verify2FA) :
sessionStorage.removeItem('tempToken');
sessionStorage.removeItem('tempUserId');
localStorage.removeItem('tempToken');
                    }

                    setTimeout(() => {
                        window.location.href = redirectUrl;
                    }, 1000);

                } else {
                    showToast(data.message || "Code OTP incorrect.", "error");
                }
            } catch (error) {
                console.error('Erreur lors de la vérification 2FA :', error);
                showToast("Erreur de connexion au serveur.", "error");
            }
        });
    }

    // --- 4. Helper Toast Notification ---
    function showToast(msg, type = "info") {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // Démarrage initial du compte à rebours
    window.startTimer();
});
