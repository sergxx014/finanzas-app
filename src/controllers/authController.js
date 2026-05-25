'use strict';
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const { v4: uuidv4 } = require('uuid');
const speakeasy = require('speakeasy');
const qrcode    = require('qrcode');
const db        = require('../utils/db');
const logger    = require('../utils/logger');

const { Op }    = require('sequelize');
const mailer    = require('../utils/mailer');

const ROUNDS = 12;
const APP_NAME = 'FinanzasApp';

/* ── helpers ──────────────────────────────────────────────── */
function sessionLogin(req, userId, name, role) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.userId    = userId;
      req.session.name      = name;
      req.session.role      = role;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      req.session.ua        = req.headers['user-agent'] || '';
      req.session.save(err2 => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

/* ── register ─────────────────────────────────────────────── */
async function register(req, res) {
  try {
    const { name, email, password, cookieConsent, privacyConsent } = req.body;

    const existing = await db.User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ ok: false, errors: ['El correo ya está registrado.'] });

    const hash   = await bcrypt.hash(password, ROUNDS);
    const userId = uuidv4();

    // Transacción SQL (ACID) para inserción segura de usuario y consentimiento
    const t = await db.sequelize.transaction();
    try {
      await db.User.create({ id: userId, name, email, hash, role: 'user', active: true }, { transaction: t });
      await db.Consent.create({ userId, email, cookieConsent, privacyConsent, ip: req.ip, ua: req.headers['user-agent'] }, { transaction: t });
      await t.commit();
    } catch (txError) {
      await t.rollback();
      throw txError;
    }

    await sessionLogin(req, userId, name, 'user');

    logger.info('REGISTER', { userId, email });
    res.json({ ok: true, redirect: '/dashboard' });
  } catch (e) {
    logger.error('REGISTER_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error interno. Inténtalo de nuevo.'] });
  }
}

/* ── login ────────────────────────────────────────────────── */
/**
 * Si el usuario tiene 2FA activado:
 *   1. Verificamos contraseña pero NO regeneramos sesión completa todavía
 *   2. Marcamos sesión como pre-2FA (pendingUserId, awaiting2FA=true)
 *   3. El cliente debe llamar a /api/auth/2fa/verify con el token TOTP
 *
 * Si NO tiene 2FA:
 *   Login normal directo al dashboard.
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;
    const user = await db.User.findOne({ where: { email } });

    // Hash dummy: compara siempre algo aunque el usuario no exista
    // → mismo tiempo de respuesta → previene user enumeration por timing
    const dummy = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/leyRBLUzCEbwM2Bpe';
    const valid = await bcrypt.compare(password, user ? user.hash : dummy);

    if (!user || !valid || !user.active) {
      logger.security('LOGIN_FAIL', { ip: req.ip, email });
      return res.status(401).json({ ok: false, errors: ['Credenciales incorrectas.'] });
    }

    // Si tiene 2FA → pre-sesión esperando verificación TOTP
    if (user.totpEnabled) {
      req.session.regenerate(err => {
        if (err) {
          logger.error('LOGIN_ERR', { msg: err.message });
          return res.status(500).json({ ok: false, errors: ['Error interno.'] });
        }
        req.session.pendingUserId = user.id;
        req.session.awaiting2FA   = true;
        req.session.ua            = req.headers['user-agent'] || '';
        req.session.save(() => {
          logger.info('LOGIN_2FA_REQUIRED', { userId: user.id });
          res.json({ ok: true, twoFactor: true, redirect: '/login/2fa' });
        });
      });
      return;
    }

    // Sin 2FA: login normal
    user.lastLogin = new Date();
    await user.save();
    await sessionLogin(req, user.id, user.name, user.role);

    logger.info('LOGIN', { userId: user.id });
    res.json({ ok: true, twoFactor: false, redirect: '/dashboard' });
  } catch (e) {
    logger.error('LOGIN_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error interno.'] });
  }
}

/* ── logout ───────────────────────────────────────────────── */
function logout(req, res) {
  const uid = req.session?.userId;
  req.session.destroy(() => {
    res.clearCookie('sid');
    logger.info('LOGOUT', { userId: uid });
    res.redirect('/login');
  });
}

/* ── delete account (RGPD art. 17) ───────────────────────── */
async function deleteAccount(req, res) {
  try {
    const uid = req.session.userId;
    // La relación CASCADE borra Transactions y Consents automáticamente en MySQL
    await db.User.destroy({ where: { id: uid } });
    logger.info('ACCOUNT_DELETED', { userId: uid });
    req.session.destroy(() => { res.clearCookie('sid'); res.json({ ok: true }); });
  } catch (e) {
    res.status(500).json({ ok: false, errors: ['Error al eliminar.'] });
  }
}

/* ── export data (RGPD art. 20) ───────────────────────────── */
async function exportData(req, res) {
  try {
    const uid  = req.session.userId;
    const user = await db.User.findOne({ where: { id: uid } });
    const txs  = await db.Transaction.findAll({ where: { userId: uid } });
    res.setHeader('Content-Disposition', 'attachment; filename="mis-datos.json"');
    res.json({ perfil: { nombre: user.name, email: user.email, creado: user.createdAt }, transacciones: txs, exportado: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, errors: ['Error al exportar.'] });
  }
}

/* ═══════════════════════════════════════════════════════════
   2FA (TOTP - RFC 6238)
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /api/auth/2fa/setup
 * El usuario logueado pide activar 2FA. Generamos un secret y devolvemos
 * el QR para que lo escanee con Google Authenticator / Authy / etc.
 * El secret se guarda pero totpEnabled queda en false hasta la verificación.
 */
async function setup2FA(req, res) {
  try {
    const uid = req.session.userId;
    const user = await db.User.findOne({ where: { id: uid } });
    if (!user) return res.status(404).json({ ok: false, errors: ['Usuario no encontrado.'] });

    if (user.totpEnabled) {
      return res.status(400).json({ ok: false, errors: ['El 2FA ya está activado.'] });
    }

    // Generar nuevo secret (sobrescribe cualquier setup anterior no confirmado)
    const secret = speakeasy.generateSecret({
      length: 20,
      name:   `${APP_NAME} (${user.email})`,
      issuer: APP_NAME,
    });

    user.totpSecret = secret.base32;
    await user.save();

    // Generar QR como data URL para mostrar en el frontend
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);

    logger.info('2FA_SETUP_INIT', { userId: uid });
    res.json({
      ok: true,
      qr: qrDataUrl,
      secret: secret.base32,  // por si el usuario quiere introducirlo manualmente
    });
  } catch (e) {
    logger.error('2FA_SETUP_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error al iniciar 2FA.'] });
  }
}

/**
 * POST /api/auth/2fa/enable
 * El usuario confirma que escaneó el QR enviando el primer token TOTP.
 * Si es válido → activamos definitivamente totpEnabled.
 */
async function enable2FA(req, res) {
  try {
    const { token } = req.body;
    if (!token || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ ok: false, errors: ['El código debe tener 6 dígitos.'] });
    }

    const uid = req.session.userId;
    const user = await db.User.findOne({ where: { id: uid } });

    if (!user.totpSecret) {
      return res.status(400).json({ ok: false, errors: ['Primero inicia el setup de 2FA.'] });
    }

    const valid = speakeasy.totp.verify({
      secret:   user.totpSecret,
      encoding: 'base32',
      token,
      window:   1,   // tolerancia ±30s
    });

    if (!valid) {
      logger.security('2FA_ENABLE_INVALID_TOKEN', { userId: uid, ip: req.ip });
      return res.status(401).json({ ok: false, errors: ['Código incorrecto.'] });
    }

    user.totpEnabled = true;
    await user.save();

    logger.info('2FA_ENABLED', { userId: uid });
    res.json({ ok: true });
  } catch (e) {
    logger.error('2FA_ENABLE_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error al activar 2FA.'] });
  }
}

/**
 * POST /api/auth/2fa/disable
 * El usuario desactiva 2FA. Requiere su contraseña actual como confirmación.
 */
async function disable2FA(req, res) {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ ok: false, errors: ['Contraseña requerida.'] });

    const uid = req.session.userId;
    const user = await db.User.findOne({ where: { id: uid } });
    const valid = await bcrypt.compare(password, user.hash);

    if (!valid) {
      logger.security('2FA_DISABLE_BAD_PASSWORD', { userId: uid, ip: req.ip });
      return res.status(401).json({ ok: false, errors: ['Contraseña incorrecta.'] });
    }

    user.totpEnabled = false;
    user.totpSecret  = null;
    await user.save();

    logger.info('2FA_DISABLED', { userId: uid });
    res.json({ ok: true });
  } catch (e) {
    logger.error('2FA_DISABLE_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error al desactivar 2FA.'] });
  }
}

/**
 * POST /api/auth/2fa/verify
 * Segundo paso del login: el usuario ya pasó la contraseña y ahora envía el TOTP.
 * Si es válido → completamos la sesión real y damos acceso al dashboard.
 */
async function verify2FA(req, res) {
  try {
    if (!req.session.awaiting2FA || !req.session.pendingUserId) {
      return res.status(401).json({ ok: false, errors: ['No hay verificación 2FA pendiente.'] });
    }

    const { token } = req.body;
    if (!token || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ ok: false, errors: ['El código debe tener 6 dígitos.'] });
    }

    const user = await db.User.findOne({ where: { id: req.session.pendingUserId } });
    if (!user || !user.totpEnabled || !user.totpSecret) {
      logger.security('2FA_VERIFY_INVALID_STATE', { ip: req.ip });
      return res.status(401).json({ ok: false, errors: ['Estado inválido. Inicia sesión de nuevo.'] });
    }

    const valid = speakeasy.totp.verify({
      secret:   user.totpSecret,
      encoding: 'base32',
      token,
      window:   1,
    });

    if (!valid) {
      logger.security('2FA_VERIFY_FAIL', { userId: user.id, ip: req.ip });
      return res.status(401).json({ ok: false, errors: ['Código incorrecto.'] });
    }

    // Éxito: completar sesión real
    user.lastLogin = new Date();
    await user.save();
    await sessionLogin(req, user.id, user.name, user.role);

    logger.info('LOGIN_2FA_OK', { userId: user.id });
    res.json({ ok: true, redirect: '/dashboard' });
  } catch (e) {
    logger.error('2FA_VERIFY_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error interno.'] });
  }
}

/**
 * GET /api/auth/2fa/status
 * Devuelve si el usuario tiene 2FA activado (para que el frontend lo refleje).
 */
async function status2FA(req, res) {
  try {
    const user = await db.User.findOne({ where: { id: req.session.userId } });
    res.json({ ok: true, enabled: !!user?.totpEnabled });
  } catch (e) {
    res.status(500).json({ ok: false, errors: ['Error.'] });
  }
}

/* ═══════════════════════════════════════════════════════════
   PERFIL DE USUARIO — edición de nombre, email, contraseña
   ═══════════════════════════════════════════════════════════ */

/**
 * PUT /api/auth/profile
 * Actualiza nombre y/o email del usuario logueado.
 * Si el email cambia, verifica que no esté en uso por otra cuenta.
 */
async function updateProfile(req, res) {
  try {
    const { name, email } = req.body;
    const uid  = req.session.userId;
    const user = await db.User.findOne({ where: { id: uid } });
    if (!user) return res.status(404).json({ ok: false, errors: ['Usuario no encontrado.'] });

    // Comprobar duplicado solo si el email cambió
    if (email !== user.email) {
      const existing = await db.User.findOne({ where: { email } });
      if (existing) {
        logger.security('PROFILE_EMAIL_CONFLICT', { userId: uid, email });
        return res.status(409).json({ ok: false, errors: ['Ese correo ya está registrado por otra cuenta.'] });
      }
    }

    user.name  = name;
    user.email = email;
    await user.save();

    // Sincronizar nombre con la sesión activa
    req.session.name = name;
    await new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));

    logger.info('PROFILE_UPDATED', { userId: uid });
    res.json({ ok: true, name, email });
  } catch (e) {
    logger.error('PROFILE_UPDATE_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error al actualizar el perfil.'] });
  }
}

/**
 * PUT /api/auth/password
 * Cambia la contraseña del usuario logueado.
 * Requiere: contraseña actual + nueva + confirmación.
 * Si tiene 2FA activo → también requiere el código TOTP.
 *
 * Tras éxito, se invalidan TODAS las sesiones del usuario (regenera sesión actual
 * y fuerza re-login en otros dispositivos)
 */
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword, totpToken } = req.body;
    const uid  = req.session.userId;
    const user = await db.User.findOne({ where: { id: uid } });
    if (!user) return res.status(404).json({ ok: false, errors: ['Usuario no encontrado.'] });

    // 1. Verificar contraseña actual
    const validPwd = await bcrypt.compare(currentPassword, user.hash);
    if (!validPwd) {
      logger.security('PWD_CHANGE_BAD_CURRENT', { userId: uid, ip: req.ip });
      return res.status(401).json({ ok: false, errors: ['La contraseña actual es incorrecta.'] });
    }

    // 2. Si tiene 2FA activo → exigir código TOTP
    if (user.totpEnabled) {
      if (!totpToken) {
        return res.status(400).json({ ok: false, errors: ['Se requiere el código 2FA de 6 dígitos para cambiar la contraseña.'] });
      }
      if (!/^\d{6}$/.test(totpToken)) {
        return res.status(400).json({ ok: false, errors: ['El código 2FA debe tener 6 dígitos.'] });
      }
      const validTotp = speakeasy.totp.verify({
        secret:   user.totpSecret,
        encoding: 'base32',
        token:    totpToken,
        window:   1,
      });
      if (!validTotp) {
        logger.security('PWD_CHANGE_BAD_TOTP', { userId: uid, ip: req.ip });
        return res.status(401).json({ ok: false, errors: ['Código 2FA incorrecto.'] });
      }
    }

    // 3. La nueva contraseña debe ser distinta de la actual
    const sameAsCurrent = await bcrypt.compare(newPassword, user.hash);
    if (sameAsCurrent) {
      return res.status(400).json({ ok: false, errors: ['La nueva contraseña debe ser diferente a la actual.'] });
    }

    // 4. Hash y guardado
    user.hash = await bcrypt.hash(newPassword, ROUNDS);
    await user.save();

    // 5. Regenerar sesión actual (anti session-fixation tras cambio de credenciales)
    await sessionLogin(req, user.id, user.name, user.role);

    logger.info('PWD_CHANGED', { userId: uid });
    res.json({ ok: true });
  } catch (e) {
    logger.error('PWD_CHANGE_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error al cambiar la contraseña.'] });
  }
}

/* ═══════════════════════════════════════════════════════════
   RESET DE CONTRASEÑA (olvidé mi contraseña)
   ═══════════════════════════════════════════════════════════ */

/**
 * POST /api/auth/forgot-password
 * Genera un token de reset y envía email. Responde igual exista o no
 * el correo para evitar user enumeration.
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    const user = await db.User.findOne({ where: { email } });

    if (user) {
      const token   = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
      user.passwordResetToken   = token;
      user.passwordResetExpires = expires;
      await user.save();
      await mailer.sendPasswordReset(email, token);
      logger.info('PWD_RESET_REQUESTED', { userId: user.id });
    }

    // Siempre la misma respuesta
    res.json({ ok: true, msg: 'Si ese correo está registrado, recibirás un enlace en breve.' });
  } catch (e) {
    logger.error('FORGOT_PWD_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error interno. Inténtalo de nuevo.'] });
  }
}

/**
 * POST /api/auth/reset-password
 * Valida el token y establece la nueva contraseña.
 */
async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body;

    const user = await db.User.findOne({
      where: {
        passwordResetToken:   token,
        passwordResetExpires: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ ok: false, errors: ['El enlace no es válido o ha expirado.'] });
    }

    user.hash                 = await bcrypt.hash(newPassword, ROUNDS);
    user.passwordResetToken   = null;
    user.passwordResetExpires = null;
    await user.save();

    logger.info('PWD_RESET_DONE', { userId: user.id });
    res.json({ ok: true, redirect: '/login' });
  } catch (e) {
    logger.error('RESET_PWD_ERR', { msg: e.message });
    res.status(500).json({ ok: false, errors: ['Error interno. Inténtalo de nuevo.'] });
  }
}

module.exports = {
  register, login, logout, deleteAccount, exportData,
  setup2FA, enable2FA, disable2FA, verify2FA, status2FA,
  updateProfile, changePassword,
  forgotPassword, resetPassword,
};
