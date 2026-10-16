
//const pool = require('./db')
//const bcrypt = require('bcryptjs')


// DOM Elements
        const registerForm = document.getElementById('registerForm');
        const themeToggleBtn = document.getElementById('themeToggleBtn');
        const passwordInput = document.getElementById('password');
        const confirmPasswordInput = document.getElementById('confirmPassword');
        const lengthHint = document.getElementById('lengthHint');
        const matchHint = document.getElementById('matchHint');
        const roleCards = document.querySelectorAll('.role-card');

        // 1. Gestion du Mode Sombre / Clair
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            themeToggleBtn.textContent = newTheme === 'dark' ? '☀️️' : '🌙';
        });

        // 2. Gestion du Voir/Cacher le mot de passe
        document.querySelectorAll('.toggle-password-btn').forEach(button => {
            button.addEventListener('click', () => {
                const targetId = button.getAttribute('data-target');
                const targetInput = document.getElementById(targetId);
                const eyeOpen = button.querySelector('.icon-eye-open');
                const eyeClosed = button.querySelector('.icon-eye-closed');

                if (targetInput.type === 'password') {
                    targetInput.type = 'text';
                    eyeOpen.style.display = 'none';
                    eyeClosed.style.display = 'block';
                } else {
                    targetInput.type = 'password';
                    eyeOpen.style.display = 'block';
                    eyeClosed.style.display = 'none';
                }
            });
        });

        // 3. Style actif pour la sélection des rôles
        roleCards.forEach(card => {
            card.addEventListener('click', () => {
                roleCards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                card.querySelector('input[type="radio"]').checked = true;
            });
        });

        // 4. Validation en temps réel des mots de passe
        function validatePasswords() {
            const passVal = passwordInput.value;
            const confirmVal = confirmPasswordInput.value;

            // Longueur minimale
            if (passVal.length >= 8) {
                lengthHint.classList.add('valid');
                lengthHint.classList.remove('invalid');
                lengthHint.textContent = '✓ Au moins 8 caractères';
            } else {
                lengthHint.classList.remove('valid');
                lengthHint.classList.add('invalid');
                lengthHint.textContent = '● Au moins 8 caractères';
            }

            // Correspondance
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

        passwordInput.addEventListener('input', validatePasswords);
        confirmPasswordInput.addEventListener('input', validatePasswords);
        
        // Helper: Toast Notification
        function showToast(message, type = 'success') {
            const toastContainer = document.getElementById('toastContainer');
            const toast = document.createElement('div');
            toast.className = 'toast';
            if (type === 'danger') toast.style.borderLeftColor = 'var(--danger)';
            
            toast.innerHTML = `<span>${type === 'success' ? '✅' : '⚠️'}</span> <div>${message}</div>`;
            toastContainer.appendChild(toast);

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // Validation du format d'email
const isValidEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
};

// Validation de la force du mot de passe (Min 8 car, 1 majuscule, 1 chiffre)
const isStrongPassword = (password) => {
  return password.length >= 8 && /[A-Z]/.test(password) && /[0-9]/.test(password);
};

/*exports.registerUser = async (req, res) => {
  try {
    const {id, lastName, firstName,  email, phone, password, role, department} = req.body;

    // 1. Validation des champs requis
    if (!firstName || !lastName || !email || !password || !department) {
      return res.status(400).json({ 
        success: false, 
        message: 'Veuillez remplir tous les champs obligatoires (prénom, nom, email, mot de passe).' 
      });
    }

    // 2. Validation du format Email
    if (!isValidEmail(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'L\'adresse email saisie est invalide.' 
      });
    }

    // 3. Validation de la sécurité du mot de passe
    if (!isStrongPassword(password)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Le mot de passe doit contenir au moins 8 caractères, une majuscule et un chiffre.' 
      });
    }

    // 4. Vérification si l'email existe déjà dans MySQL
    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE email = ?', 
      [email.toLowerCase().trim()]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: 'Un compte existe déjà avec cette adresse email.' 
      });
    }

    // 5. Hachage sécurisé du mot de passe
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 6. Rôle par défaut (Agent)
    const userRole = (role && ['agent', 'manager'].includes(role)) ? role : 'agent';

                    // Récupération des données du formulaire
            const newUser = {                
                lastName: document.getElementById('fullName').value.trim(),
                email: document.getElementById('email').value.trim(),
                username: document.getElementById('username').value.trim(),
                phone: document.getElementById('numero').value.trim(),
                department: document.getElementById('department').value,
                role: document.querySelector('input[name="role"]:checked').value,
                password: passwordHash,
                id: lastName + Date.now()
            };

            const [result] = await pool.query(
      `INSERT INTO users (id, last_name, username,  email, phone, password_hash, role, departement) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id.trim(),
        lastName.trim(), 
        firstName.trim(), 
        email.toLowerCase().trim(), 
        phone.trim(), 
        passwordHash, 
        role.trim(),
        department.trim(),
      ]
    );

        // 8. Réponse de succès
    return res.status(201).json({
      success: true,
      message: 'Compte créé avec succès !',
      user: {
        id: result.insertId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.toLowerCase().trim(),
        role: userRole
      }
    });

    

    } catch (error) {
    console.error('Erreur lors de la création de compte :', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Une erreur interne est survenue lors de l\'inscription.' 
    });
  }
};*/