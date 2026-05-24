'use strict';
const rateLimit = require('express-rate-limit');
const { MemoryStore } = require('express-rate-limit');
const logger    = require('../utils/logger');

// Store propio para poder resetearlo entre tests con __resetLimiters()
// (No expone ninguna ruta HTTP; solo accesible por otros módulos Node.js del mismo proceso)
const loginStore = new MemoryStore();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: loginStore,
  handler: (req, res) => {
    logger.security('RATE_LIMIT_LOGIN', { ip: req.ip });
    res.status(429).json({ ok: false, errors: ['Demasiados intentos. Espera 1 minuto.'] });
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    logger.security('UNAUTH', { ip: req.ip, path: req.path });
    return res.status(401).json({ ok: false, errors: ['Sesión expirada.'] });
  }
  // Fingerprint de sesión: detecta cambio de User-Agent 
  if (req.session.ua && req.session.ua !== (req.headers['user-agent'] || '')) {
    logger.security('SESSION_HIJACK_DETECTED', { ip: req.ip, userId: req.session.userId });
    req.session.destroy(() => {});
    return res.status(401).json({ ok: false, errors: ['Sesión invalidada por cambio de cliente.'] });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session?.role !== 'admin') {
    logger.security('ADMIN_ACCESS_DENIED', { ip: req.ip, userId: req.session?.userId });
    return res.status(403).json({ ok: false, errors: ['Acceso denegado.'] });
  }
  next();
}

function csrfProtect(req, res, next) {
  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session?.csrfToken) {
    logger.security('CSRF_REJECTED', { ip: req.ip, path: req.path });
    return res.status(403).json({ ok: false, errors: ['Token CSRF inválido.'] });
  }
  next();
}

/* Solo para tests — no expone ninguna ruta HTTP, solo accesible vía require() interno */
function __resetLimiters() {
  loginStore.resetAll();
}

module.exports = {
  loginLimiter, registerLimiter, apiLimiter,
  requireAuth, requireAdmin, csrfProtect,
  __resetLimiters,
};
