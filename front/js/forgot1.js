document.addEventListener('DOMContentLoaded', () => {
    // Variable pour stocker l'e-mail saisi à l'étape 1
    const urlParams = new URLSearchParams(window.location.search);
    let userEmail = urlParams.get('email') || sessionStorage.getItem('resetEmail') || '';

    // Éléments du DOM
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const step1Form = document.getElementById('step1Form');
    const step2Form = document.getElementById('step2Form');

    const newPasswordInput = document.getElementById('newPassword');
    const confirmNewPasswordInput = document.getElementById('confirmNewPassword');
    const lengthHint = document.getElementById('lengthHint');
    const matchHint = document.getElementById('matchHint');

    // Helper Toast pour afficher les notifications
    function showToast(message, type = 'success') {
        const toastContainer = document.getElementById('toastContainer');
        if (!toastContainer) {
            alert(message);
            return;
        }

        const toast = document.createElement('div');
        toast.className = 'toast';
        if (type === 'danger') toast.style.borderLeftColor = 'var(--danger)';

        const icon = document.createElement('span');
        icon.textContent = type === 'success' ? '✅' : '⚠️';
        const text = document.createElement('div');
        text.textContent = String(message);
        toast.append(icon, text);
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // 1. Thème Sombre / Clair
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            themeToggleBtn.textContent = newTheme === 'dark' ? '☀' : '🌙';
        });
    }

    // 2. Bascule afficher / masquer le mot de passe
    document.querySelectorAll('.toggle-password-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-target');
            const targetInput = document.getElementById(targetId);
            const eyeOpen = button.querySelector('.icon-eye-open');
            const eyeClosed = button.querySelector('.icon-eye-closed');

            if (targetInput && targetInput.type === 'password') {
                targetInput.type = 'text';
                if (eyeOpen) eyeOpen.style.display = 'none';
                if (eyeClosed) eyeClosed.style.display = 'block';
            } else if (targetInput) {
                targetInput.type = 'password';
                if (eyeOpen) eyeOpen.style.display = 'block';
                if (eyeClosed) eyeClosed.style.display = 'none';
            }
        });
    });

    // 3. Validation du mot de passe en temps réel
    function validateNewPassword() {
        if (!newPasswordInput || !confirmNewPasswordInput) return false;

        const passVal = newPasswordInput.value;
        const confirmVal = confirmNewPasswordInput.value;

        let isValid = true;

        // Longueur minimale alignée sur la règle du serveur.
        if (lengthHint) {
            if (passVal.length >= 12) {
                lengthHint.classList.add('valid');
                lengthHint.classList.remove('invalid');
                lengthHint.textContent = '✓ Au moins 12 caractères';
            } else {
                lengthHint.classList.remove('valid');
                lengthHint.classList.add('invalid');
                lengthHint.textContent = '● Au moins 12 caractères';
                isValid = false;
            }
        }

        // Correspondance
        if (matchHint) {
            if (confirmVal.length > 0) {
                if (passVal === confirmVal) {
                    matchHint.classList.add('valid');
                    matchHint.classList.remove('invalid');
                    matchHint.textContent = '✓ Les mots de passe correspondent';
                } else {
                    matchHint.classList.remove('valid');
                    matchHint.classList.add('invalid');
                    matchHint.textContent = '✕ Les mots de passe ne correspondent pas';
                    isValid = false;
                }
            } else {
                matchHint.classList.remove('valid', 'invalid');
                matchHint.textContent = '● Les mots de passe doivent correspondre';
                isValid = false;
            }
        }

        return isValid && passVal.length >= 12 && passVal === confirmVal;
    }

    if (newPasswordInput && confirmNewPasswordInput) {
        newPasswordInput.addEventListener('input', validateNewPassword);
        confirmNewPasswordInput.addEventListener('input', validateNewPassword);
    }

    // 4. Soumission Étape 1 : Demande de code OTP par Email
    if (step1Form) {
        step1Form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const identifier = document.getElementById('identifier')?.value.trim();

            if (!identifier) {
                return showToast("Veuillez saisir votre identifiant ou e-mail.", "danger");
            }

            const btn = document.getElementById('btnStep1');
            const spinner = document.getElementById('spinner1');
            const btnText = document.getElementById('etape1');

            if (spinner) spinner.style.display = 'inline-block';
            if (btnText) btnText.textContent = 'Vérification...';
            if (btn) btn.disabled = true;

            try {
                const response = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: identifier })
                });

                const data = await response.json();

                if (response.ok) {
                    sessionStorage.setItem('resetEmail', identifier);
                    showToast(data.message || 'Code envoyé par e-mail !', 'success');

                    setTimeout(() => {
                        window.location.href = `../html/auth_pass_forgot_2.html?email=${encodeURIComponent(identifier)}`;
                    }, 1000);
                } else {
                    showToast(data.message || "Adresse e-mail introuvable.", 'danger');
                }
            } catch (err) {
                console.error("Erreur réseau :", err);
                showToast("Impossible de contacter le serveur.", "danger");
            } finally {
                if (spinner) spinner.style.display = 'none';
                if (btnText) btnText.textContent = 'Envoyer le code';
                if (btn) btn.disabled = false;
            }
        });
    }

    // 5. Soumission Étape 2 : Verification OTP et Réinitialisation du Mot de Passe
    if (step2Form) {
        step2Form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const otpCode = document.getElementById('otpCode')?.value.trim();
            const newPassword = newPasswordInput?.value;
            const targetEmail = userEmail || sessionStorage.getItem('resetEmail');

            if (!targetEmail) {
                showToast("Session de réinitialisation expirée. Veuillez recommencer.", "danger");
                setTimeout(() => window.location.href = 'auth_pass_forgot.html', 1500);
                return;
            }

            if (!otpCode || otpCode.length < 4) {
                return showToast("Veuillez saisir le code de vérification à 6 chiffres.", "danger");
            }

            if (!validateNewPassword()) {
                return showToast("Veuillez respecter les critères de mot de passe.", "danger");
            }

            const btn = document.getElementById('btnStep2');
            const spinner = document.getElementById('spinner2');
            const btnText = document.getElementById('etape2');

            if (spinner) spinner.style.display = 'inline-block';
            if (btnText) btnText.textContent = 'Réinitialisation...';
            if (btn) btn.disabled = true;

            try {
                const response = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: targetEmail,
                        code: otpCode,
                        newPassword: newPassword
                    })
                });

                const data = await response.json();

                if (response.ok && data.success) {
                    sessionStorage.removeItem('resetEmail');
                    showToast("Mot de passe réinitialisé avec succès ! Connexion...", "success");

                    setTimeout(() => {
                        window.location.href = '/index.html';
                    }, 1500);
                } else {
                    showToast(data.message || "Code incorrect ou expiré.", "danger");
                }
            } catch (err) {
                console.error("Erreur réseau :", err);
                showToast("Erreur serveur lors de la réinitialisation.", "danger");
            } finally {
                if (spinner) spinner.style.display = 'none';
                if (btnText) btnText.textContent = 'Réinitialiser le mot de passe';
                if (btn) btn.disabled = false;
            }
        });
    }
});
