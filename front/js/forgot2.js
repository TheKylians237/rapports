document.addEventListener('DOMContentLoaded', () => {

    // --- State & Variables ---
    let countdownValue = 30;
    let countdownTimer = null;
    let isOtpVerified = false; // Flag pour suivre la validation du code OTP

    // --- Éléments DOM ---
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const otpInputs = document.querySelectorAll('.otp-input');
    const newPassword = document.getElementById('newPassword');
    const confirmPassword = document.getElementById('confirmPassword');
    const strengthFill = document.getElementById('strengthFill');
    const strengthLabel = document.getElementById('strengthLabel');
    const lengthHint = document.getElementById('lengthHint');
    const specialCharHint = document.getElementById('specialCharHint');
    const matchHint = document.getElementById('matchHint');
    const resendBtn = document.getElementById('resendBtn');
    const resetStep2Form = document.getElementById('resetStep2Form');
    const btnSubmit = document.getElementById('btnSubmit');

    // Récupérer l'e-mail depuis l'URL (?email=user@domain.com) ou la session
    const urlParams = new URLSearchParams(window.location.search);
    const email = urlParams.get('email') || sessionStorage.getItem('resetEmail') || localStorage.getItem('app_reset_email') || '';

    // --- INITIALISATION : Griser la section mot de passe par défaut ---
    function setPasswordFieldsState(enabled) {
        if (newPassword) {
            newPassword.disabled = !enabled;
            newPassword.style.opacity = enabled ? '1' : '0.6';
        }
        if (confirmPassword) {
            confirmPassword.disabled = !enabled;
            confirmPassword.style.opacity = enabled ? '1' : '0.6';
        }
        if (btnSubmit) {
            btnSubmit.disabled = !enabled;
        }
    }
    setPasswordFieldsState(false); // Champs grisés au chargement initial

    // 1. Thème Sombre / Clair
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            themeToggleBtn.textContent = newTheme === 'dark' ? '☀' : '🌙';
        });
    }

    // --- Fonction de Vérification de l'OTP auprès du Serveur Backend ---
    async function checkOtpWithBackend(otpCode) {
        if (!email) {
            showToast("E-mail manquant dans la requête. Veuillez recommencer.", 'danger');
            return;
        }

        try {
            showToast('Vérification du code OTP...', 'info');

            const response = await fetch('/api/auth/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp: otpCode })
            });

            const data = await response.json();

            if (response.ok && (data.success || data.valid)) {
                isOtpVerified = true;
                showToast(data.message || 'Code OTP valide ! Saisissez votre nouveau mot de passe.', 'success');
                setPasswordFieldsState(true); // 🔓 DÉVERROUILLAGE des champs
                if (newPassword) newPassword.focus();
            } else {
                isOtpVerified = false;
                setPasswordFieldsState(false); // 🔒 Maintien du verrouillage
                showToast(data.message || 'Code OTP incorrect ou expiré.', 'danger');
            }
        } catch (err) {
            console.error('Erreur vérification OTP:', err);
            showToast('Erreur de connexion lors de la vérification du code.', 'danger');
        }
    }

    // Récupère l'OTP saisi sur les 6 inputs
    function getEnteredOtp() {
        let code = '';
        otpInputs.forEach(input => code += input.value.trim());
        return code;
    }

    // 2. Gestion des Inputs OTP (Auto-focus, Backspace, Paste & Auto-Check)
    otpInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            const value = e.target.value;

            if (value.length === 1 && index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }

            const code = getEnteredOtp();
            if (code.length === 6) {
                checkOtpWithBackend(code);
            } else {
                if (isOtpVerified) {
                    isOtpVerified = false;
                    setPasswordFieldsState(false);
                }
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });

        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasteData = e.clipboardData.getData('text').trim().slice(0, 6);
            if (/^\d+$/.test(pasteData)) {
                pasteData.split('').forEach((char, i) => {
                    if (otpInputs[i]) otpInputs[i].value = char;
                });

                const code = getEnteredOtp();
                if (code.length === 6) {
                    checkOtpWithBackend(code);
                }
            }
        });
    });

    // 3. Masquer / Afficher le mot de passe
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

    // 4. Calculateur de force du mot de passe
    function evaluatePasswordStrength(password) {
        if (!strengthFill || !strengthLabel) return;

        let score = 0;
        if (password.length >= 12) score++;
        if (password.length >= 12) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;
        if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;

        let fillWidth = '20%';
        let fillColor = 'var(--danger)';
        let label = 'Très faible';

        if (score >= 4) {
            fillWidth = '100%';
            fillColor = 'var(--success)';
            label = 'Très fort';
        } else if (score === 3) {
            fillWidth = '75%';
            fillColor = 'var(--warning)';
            label = 'Moyen';
        } else if (score === 2) {
            fillWidth = '50%';
            fillColor = '#f97316';
            label = 'Acceptable';
        } else if (score === 1) {
            fillWidth = '25%';
            fillColor = 'var(--danger)';
            label = 'Faible';
        }

        if (!password) {
            fillWidth = '0%';
            label = 'Aucun';
        }

        strengthFill.style.width = fillWidth;
        strengthFill.style.backgroundColor = fillColor;
        strengthLabel.textContent = label;
        strengthLabel.style.color = fillColor;
    }

    // 5. Validation dynamique des critères
    function validateFormInputs() {
        if (!newPassword || !confirmPassword) return;

        const val = newPassword.value;
        const confirmVal = confirmPassword.value;

        // Longueur
        if (lengthHint) {
            if (val.length >= 12) {
                lengthHint.classList.add('valid');
                lengthHint.classList.remove('invalid');
                lengthHint.textContent = '✓ Minimum 12 caractères';
            } else {
                lengthHint.classList.remove('valid');
                lengthHint.classList.add('invalid');
                lengthHint.textContent = '● Minimum 12 caractères';
            }
        }

        // Chiffre ou Caractère Spécial
        if (specialCharHint) {
            if (/[0-9]/.test(val) || /[^A-Za-z0-9]/.test(val)) {
                specialCharHint.classList.add('valid');
                specialCharHint.classList.remove('invalid');
                specialCharHint.textContent = '✓ Contient un chiffre ou symbole';
            } else {
                specialCharHint.classList.remove('valid');
                specialCharHint.classList.add('invalid');
                specialCharHint.textContent = '● Au moins un chiffre ou caractère spécial';
            }
        }

        // Correspondance
        if (matchHint) {
            if (confirmVal.length > 0) {
                if (val === confirmVal) {
                    matchHint.classList.add('valid');
                    matchHint.classList.remove('invalid');
                    matchHint.textContent = '✓ Les mots de passe sont identiques';
                } else {
                    matchHint.classList.remove('valid');
                    matchHint.classList.add('invalid');
                    matchHint.textContent = '✕ Les mots de passe ne correspondent pas';
                }
            } else {
                matchHint.classList.remove('valid', 'invalid');
                matchHint.textContent = '● Les mots de passe doivent être identiques';
            }
        }

        evaluatePasswordStrength(val);
    }

    if (newPassword && confirmPassword) {
        newPassword.addEventListener('input', validateFormInputs);
        confirmPassword.addEventListener('input', validateFormInputs);
    }

    // 6. Compte à rebours du Renvoi de Code
    function startCountdown() {
        if (!resendBtn) return;
        countdownValue = 30;
        resendBtn.disabled = true;
        resendBtn.innerHTML = `Renvoyer (<span id="countdown">${countdownValue}</span>s)`;

        clearInterval(countdownTimer);
        countdownTimer = setInterval(() => {
            countdownValue--;
            const span = document.getElementById('countdown');
            if (span) span.textContent = countdownValue;

            if (countdownValue <= 0) {
                clearInterval(countdownTimer);
                resendBtn.disabled = false;
                resendBtn.textContent = 'Renvoyer le code';
            }
        }, 1000);
    }
    startCountdown();

    // Renvoi du code
    if (resendBtn) {
        resendBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/api/auth/reset-otp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });

                const data = await response.json();

                if (response.ok) {
                    showToast('Nouveau code envoyé par e-mail !', 'success');
                    otpInputs.forEach(input => input.value = '');
                    setPasswordFieldsState(false);
                    isOtpVerified = false;
                    startCountdown();
                } else {
                    showToast(data.message || 'Erreur lors du renvoi du code.', 'danger');
                }
            } catch (err) {
                console.error('Erreur renvoi OTP:', err);
                showToast('Impossible de contacter le serveur.', 'danger');
            }
        });
    }

    // 7. Soumission du Formulaire & Enregistrement Final
    if (resetStep2Form) {
        resetStep2Form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!isOtpVerified) {
                showToast('Veuillez d\'abord valider un code OTP correct.', 'danger');
                return;
            }

            const val = newPassword.value;
            const confirmVal = confirmPassword.value;
            const otpCode = getEnteredOtp();

            if (val.length < 12) {
                showToast('Le mot de passe doit comporter au moins 12 caractères.', 'danger');
                return;
            }

            if (val !== confirmVal) {
                showToast('Les deux mots de passe ne correspondent pas.', 'danger');
                return;
            }

            const spinner = document.getElementById('spinner');
            const btnText = btnSubmit ? btnSubmit.querySelector('.btn-text') : null;

            if (spinner) spinner.style.display = 'inline-block';
            if (btnText) btnText.textContent = 'Enregistrement...';
            if (btnSubmit) btnSubmit.disabled = true;

            try {
                const response = await fetch('/api/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        code: otpCode,
                        newPassword: val
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    sessionStorage.removeItem('resetEmail');
                    showToast(data.message || 'Votre mot de passe a été réinitialisé avec succès !', 'success');
                    setTimeout(() => {
                        window.location.href = '/index.html';
                    }, 1500);
                } else {
                    showToast(data.message || 'Erreur lors de la réinitialisation.', 'danger');
                    if (btnSubmit) btnSubmit.disabled = false;
                    if (spinner) spinner.style.display = 'none';
                    if (btnText) btnText.textContent = 'Valider';
                }
            } catch (err) {
                console.error('Erreur serveur:', err);
                showToast('Impossible de contacter le serveur pour la mise à jour.', 'danger');
                if (btnSubmit) btnSubmit.disabled = false;
                if (spinner) spinner.style.display = 'none';
                if (btnText) btnText.textContent = 'Valider';
            }
        });
    }

    // Helper Toast
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
});
