'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const helmet  = require('helmet');
const path    = require('path');
const logger  = require('./utils/logger');
const db      = require('./utils/db');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Security headers (helmet con configuración personalizada) ─────────── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],                                              // sin unsafe-inline en scripts: bloquea XSS reflejado
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], // unsafe-inline solo en styles por compatibilidad con utilidades CSS
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],                                          // anti-clickjacking
      baseUri:    ["'self'"],                                              // bloquea inyección de <base>
      formAction: ["'self'"],                                              // formularios solo a mismo origen
      objectSrc:  ["'none'"],                                              // sin plugins (Flash/Java)
    },
  },
  xFrameOptions:  { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts:           { maxAge: 31536000, includeSubDomains: true },
}));

/* Permissions-Policy — helmet v7 no la incluye, la añadimos manualmente */
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

/* ── CORS: solo mismo origen (rechaza cualquier Origin externo) ────────── */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();                                              // sin Origin (curl, server-to-server)
  const serverOrigin = `${req.protocol}://${req.get('host')}`;
  if (origin !== serverOrigin) {
    logger.security('CORS_BLOCKED', { ip: req.ip, origin });
    return res.status(403).json({ ok: false, errors: ['Origen no permitido.'] });
  }
  next();
});

/* ── Body parsers (límite de 10KB para prevenir DoS por payload grande) ── */
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

/* ── Sesión persistente en MySQL (sobrevive a reinicios del servidor) ──── */
const sessionConfig = {
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  rolling: true,                                                           // renueva la expiración en cada petición
  cookie: {
    httpOnly: true,                                                        // no accesible vía JS (anti-XSS)
    secure:   process.env.COOKIE_SECURE === 'true',                        // true en HTTPS
    sameSite: 'lax',                                                       // anti-CSRF (lax permite navegación entre subdominios)
    maxAge:   24 * 60 * 60 * 1000,                                         // 24h máximo
  },
};

// En producción/desarrollo: sesiones en MySQL (persisten reinicios).
// En test: MemoryStore por defecto (el test mockea la BD).
let sessionStore = null;
if (process.env.NODE_ENV !== 'test') {
  sessionStore = new SequelizeStore({
    db: db.sequelize,
    tableName: 'Sessions',
    checkExpirationInterval: 15 * 60 * 1000,                               // limpieza cada 15 min
    expiration: 24 * 60 * 60 * 1000,                                       // 24h
  });
  sessionConfig.store = sessionStore;
}

app.use(session(sessionConfig));

// Sincroniza la tabla Sessions con la BD al arrancar (idempotente)
if (sessionStore) {
  sessionStore.sync().catch(err => logger.error('SESSION_STORE_SYNC', { msg: err.message }));
}

/* ── Rutas de páginas (ANTES del static para que la sesión decida primero) */
const pub = (f) => (req, res) => res.sendFile(path.join(__dirname, '../public', f));

app.get('/',          (req, res) => req.session.userId ? res.redirect('/dashboard') : pub('index.html')(req, res));
app.get('/login',            (req, res) => req.session.userId ? res.redirect('/dashboard') : pub('login.html')(req, res));
app.get('/login/2fa',       (req, res) => req.session.awaiting2FA ? pub('login-2fa.html')(req, res) : res.redirect('/login'));
app.get('/register',        (req, res) => req.session.userId ? res.redirect('/dashboard') : pub('register.html')(req, res));
app.get('/forgot-password', (req, res) => req.session.userId ? res.redirect('/dashboard') : pub('forgot-password.html')(req, res));
app.get('/reset-password',  pub('reset-password.html'));
app.get('/dashboard', (req, res) => req.session.userId ? pub('dashboard.html')(req, res) : res.redirect('/login?expired=1'));
app.get('/admin',     (req, res) => req.session?.role === 'admin' ? pub('admin.html')(req, res) : res.redirect('/login'));

/* ── Archivos estáticos (CSS, JS, imágenes) ────────────────────────────── */
app.use(express.static(path.join(__dirname, '../public')));

/* ── Páginas legales (RGPD / LSSI-CE) ──────────────────────────────────── */
app.get('/privacidad', pub('privacidad.html'));
app.get('/cookies',    pub('cookies.html'));
app.get('/aviso-legal', pub('aviso-legal.html'));

/* ── API REST ──────────────────────────────────────────────────────────── */
app.use('/api', require('./routes/api'));

/* ── 404 / manejador global de errores ─────────────────────────────────── */
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '../public/404.html')));

app.use((err, req, res, next) => {
  // body-parser lanza 'entity.too.large' cuando se supera el limit de 10kb
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ ok: false, errors: ['Petición demasiado grande.'] });
  }
  logger.error('UNHANDLED', { msg: err.message });
  res.status(500).json({ ok: false, errors: ['Error interno.'] });
});

/* ── Arranque del servidor (no en entorno test) ────────────────────────── */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`FinanzasApp corriendo en http://localhost:${PORT}`);
    console.log(`\n🚀  http://localhost:${PORT}\n`);
  });
}

module.exports = app;
