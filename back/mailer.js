// utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.MAIL_PORT) || 587,
  secure: String(process.env.MAIL_SECURE).toLowerCase() === 'true',
  auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASSWORD || process.env.MAIL_PASS }
});

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
async function sendAccountCredentials(toEmail, username, password) {
  if (!process.env.MAIL_USER || !(process.env.MAIL_PASSWORD || process.env.MAIL_PASS)) throw new Error('Configuration e-mail absente.');
  return transporter.sendMail({
    from: `"Gestion des Rapports" <${process.env.MAIL_USER}>`, to: toEmail,
    subject: 'Votre compte Gestion des Rapports',
    text: `Votre compte est prêt. Identifiant : ${username}\nMot de passe initial : ${password}\nPour votre sécurité, remplacez ce mot de passe depuis votre profil après la première connexion.`,
    html: `<p>Votre compte Gestion des Rapports est prêt.</p><p>Identifiant : <strong>${escapeHtml(username)}</strong><br>Mot de passe initial : <strong>${escapeHtml(password)}</strong></p><p>Pour votre sécurité, remplacez ce mot de passe depuis votre profil après la première connexion.</p>`
  });
}

// Fonction exportée pour envoyer le code 2FA
const send2FACode = async (toEmail, code) => {
    const mailOptions = {
        from: `"Service Sécurité" <${process.env.MAIL_USER}>`,
        to: toEmail,
        subject: 'Votre code de vérification 2FA',
        html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2>Authentification à deux facteurs</h2>
                <p>Voici votre code de sécurité pour valider votre connexion :</p>
                <h1 style="font-size: 32px; color: #2ecc71; letter-spacing: 5px;">${code}</h1>
                <p>Ce code expire dans <strong>10 minutes</strong>.</p>
                <p style="color: #888; font-size: 12px;">Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>
            </div>
        `
    };

    return await transporter.sendMail(mailOptions);
};

// 2. Déclaration explicite de la fonction sendResetOTP
const sendResetOTP = async (toEmail, otpCode) => {
  const mailOptions = {
    from: `"Rapports d'Activités" <${process.env.MAIL_USER}>`,
    to: toEmail,
    subject: 'Code de réinitialisation de mot de passe',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Réinitialisation de votre mot de passe</h2>
        <p>Voici votre code de vérification : <strong>${otpCode}</strong></p>
        <p>Ce code expire dans 15 minutes.</p>
      </div>
    `
  };

  return await transporter.sendMail(mailOptions);
};

module.exports = {
  transporter,
  send2FACode,
  sendResetOTP,
  sendAccountCredentials
};
