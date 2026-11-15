require('dotenv').config();

const nodemailer = require('nodemailer');

let transporter = null;
let transporterChecked = false;

function getTransporter() {
  if (transporterChecked) return transporter;
  transporterChecked = true;

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    transporter = null;
    return null;
  }

  const port = Number(process.env.SMTP_PORT) || 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Envía la alerta de seguridad por correo cuando se detectan varios
 * intentos fallidos de inicio de sesión.
 */
async function sendLoginAlertEmail({ to, fullName, cedula }) {
  const mailTransporter = getTransporter();
  if (!mailTransporter) {
    console.warn(
      'SMTP no configurado (variables SMTP_USER y SMTP_PASS). No se pudo enviar la alerta de seguridad.'
    );
    return { skipped: true };
  }

  const recipientName = fullName || 'usuario';
  const safeName = escapeHtml(recipientName);

  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Alerta de seguridad: intentos fallidos en tu cuenta',
    text: `Hola ${recipientName},

Hemos detectado varios intentos fallidos de inicio de sesión en tu cuenta.

Si no fuiste tú, alguien podría estar intentando acceder a tu información. Te recomendamos:
- Cambia tu contraseña inmediatamente.
- Revisa la actividad de tu cuenta.

Si fuiste tú, es probable que solo fallaste al escribirla. Si no recuerdas tu contraseña, cambia la contraseña desde tu panel de cuenta.

Si no reconoces estos intentos, contacta al soporte.

Saludos,
Equipo de seguridad`,
    html: `<p>Hola ${safeName},</p>
<p>Hemos detectado varios intentos fallidos de inicio de sesión en tu cuenta.</p>
<p>Si no fuiste tú, alguien podría estar intentando acceder a tu información. Te recomendamos:</p>
<ul>
<li>Cambia tu contraseña inmediatamente.</li>
<li>Revisa la actividad de tu cuenta.</li>
</ul>
<p>Si fuiste tú, es probable que solo fallaste al escribirla. Si no recuerdas tu contraseña, cambia la contraseña desde tu panel de cuenta.</p>
<p>Si no reconoces estos intentos, contacta al soporte.</p>
<p>Saludos,<br>Equipo de seguridad</p>`,
  };

  try {
    const info = await mailTransporter.sendMail(mailOptions);
    console.log(`Alerta de seguridad enviada a ${to}: ${info.response || info.messageId}`);
    return { sent: true };
  } catch (err) {
    console.error('No se pudo enviar la alerta de seguridad por email:', err.message);
    return { skipped: true, error: err.message };
  }
}

module.exports = { sendLoginAlertEmail };
