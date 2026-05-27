'use strict';
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Timeouts: si el SMTP no responde, fallar limpio en vez de colgarse
  connectionTimeout: 10000,
  greetingTimeout:   10000,
  socketTimeout:     15000,
});

async function sendPasswordReset(email, token) {
  const link = `${process.env.APP_URL}/reset-password?token=${token}`;
  await transporter.sendMail({
    from:    process.env.MAIL_FROM,
    to:      email,
    subject: 'Restablecer contraseña — FinanzasApp',
    text:    `Haz clic en el siguiente enlace para restablecer tu contraseña (válido 1 hora):\n\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
    html:    `
      <p>Haz clic en el botón para restablecer tu contraseña. El enlace es válido durante <strong>1 hora</strong>.</p>
      <p style="margin:1.5rem 0">
        <a href="${link}" style="background:#6c63ff;color:#fff;padding:.7rem 1.4rem;border-radius:6px;text-decoration:none;font-weight:600">
          Restablecer contraseña
        </a>
      </p>
      <p style="color:#888;font-size:.85rem">Si no solicitaste esto, ignora este mensaje.</p>
    `,
  });
}

module.exports = { sendPasswordReset };
