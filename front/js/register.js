document.addEventListener('DOMContentLoaded', () => {
    // 1. Éléments du DOM
    const registerForm = document.getElementById('registerForm');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const lengthHint = document.getElementById('lengthHint');
    const matchHint = document.getElementById('matchHint');
    const roleCards = document.querySelectorAll('.role-card');

    const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

const isStrongPassword = (password) => {
  return password && password.length >= 12;
};

    // 2. Gestion du Mode Sombre / Clair
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            themeToggleBtn.textContent = newTheme === 'dark' ? '☀' : '🌙';
        });
    }

    // 3. Gestion du Voir/Cacher le mot de passe
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

    // 4. Style actif pour la sélection des rôles
    roleCards.forEach(card => {
        card.addEventListener('click', () => {
            roleCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

    // 5. Validation en temps réel des mots de passe
    function validatePasswords() {
        if (!passwordInput || !confirmPasswordInput) return;

        const passVal = passwordInput.value;
        const confirmVal = confirmPasswordInput.value;

        // Validation de la longueur minimale
        if (lengthHint) {
            if (passVal.length >= 12) {
                lengthHint.classList.add('valid');
                lengthHint.classList.remove('invalid');
                lengthHint.textContent = '✓ Au moins 12 caractères';
            } else {
                lengthHint.classList.remove('valid');
                lengthHint.classList.add('invalid');
                lengthHint.textContent = '● Au moins 12 caractères';
            }
        }

        // Validation de la correspondance
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
                }
            } else {
                matchHint.classList.remove('valid', 'invalid');
                matchHint.textContent = '● Les mots de passe doivent correspondre';
            }
        }
    }

    if (passwordInput && confirmPasswordInput) {
        passwordInput.addEventListener('input', validatePasswords);
        confirmPasswordInput.addEventListener('input', validatePasswords);
    }

    // 6. Helper: Toast Notification
    function showToast(message, type = 'success') {
        const toastContainer = document.getElementById('toastContainer');
        if (!toastContainer) return;

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
        }, 3000);
    }

    // 7. Envoi du Formulaire d'Inscription au Serveur
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const passVal = passwordInput.value;
            const confirmVal = confirmPasswordInput.value;

const formData = {
    fullName: document.getElementById('fullName')?.value.trim() || '',
    email: document.getElementById('email')?.value.trim() || '',
    username: document.getElementById('username')?.value.trim() || '',
    phone: document.getElementById('phone')?.value.trim() || '', // Gardez l'ID exact de votre HTML
    department: document.getElementById('department')?.value || '',
    password: passVal
};


            if (!isValidEmail(formData.email)) {
    showToast('Email invalide', 'danger');
    return;
}



            // Vérification côté client avant envoi HTTP
            if (passVal !== confirmVal) {
                showToast('Les mots de passe ne correspondent pas.', 'danger');
                return;
            }

            if (passVal.length < 12) {
                showToast('Le mot de passe doit faire au moins 12 caractères.', 'danger');
                return;
            }

            


            try {
                const response = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });

                const data = await response.json();

                
                if (response.ok && data.success) {
                    showToast(data.message || 'Compte créé avec succès !', 'success');
                    registerForm.reset();
                    
                    // Réinitialisation des indicateurs de mots de passe
                    if (lengthHint) {
                        lengthHint.classList.remove('valid', 'invalid');
                        lengthHint.textContent = '● Au moins 12 caractères';
                    }
                    if (matchHint) {
                        matchHint.classList.remove('valid', 'invalid');
                        matchHint.textContent = '● Les mots de passe doivent correspondre';
                    }

                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 1500);
                } else {
                    showToast(data.message || 'Erreur lors de la création du compte', 'danger');
                }
            } catch (error) {
                console.error('Erreur lors de la requête :', error);
                showToast('Impossible de contacter le serveur backend.', 'danger');
            }
        });
    }
});
