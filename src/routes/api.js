'use strict';
const router = require('express').Router();
const auth   = require('../controllers/authController');
const tx     = require('../controllers/txController');
const admin  = require('../controllers/adminController');
const mid    = require('../middleware/auth');
const { schemas, validate } = require('../utils/validators');

// Auth pública
router.post('/auth/register',        mid.registerLimiter, validate(schemas.register),       auth.register);
router.post('/auth/login',           mid.loginLimiter,    validate(schemas.login),           auth.login);
router.post('/auth/forgot-password', mid.loginLimiter,    validate(schemas.forgotPassword),  auth.forgotPassword);
router.post('/auth/reset-password',  mid.loginLimiter,    validate(schemas.resetPassword),   auth.resetPassword);
router.get('/auth/me', async (req, res) => {
  if (!req.session?.userId) {
    return res.json({ ok: true, auth: false, name: '', email: '', role: '', csrfToken: '' });
  }
  // Cargamos el email actual de la BD (puede haber cambiado desde el login)
  try {
    const user = await require('../utils/db').User.findOne({ where: { id: req.session.userId } });
    res.json({
      ok: true,
      auth: true,
      name:  req.session.name || '',
      email: user?.email || '',
      role:  req.session.role || '',
      csrfToken: req.session.csrfToken || '',
    });
  } catch (e) {
    res.json({ ok: true, auth: true, name: req.session.name || '', email: '', role: req.session.role || '', csrfToken: req.session.csrfToken || '' });
  }
});

// 2FA · paso 2 del login (no requiere sesión completa, solo la pre-sesión awaiting2FA)
router.post('/auth/2fa/verify', mid.loginLimiter, auth.verify2FA);

// Auth autenticada (CSRF requerido)
router.post('/auth/logout',    mid.requireAuth, mid.csrfProtect, auth.logout);
router.delete('/auth/account', mid.requireAuth, mid.csrfProtect, auth.deleteAccount);
router.get('/auth/export',     mid.requireAuth,                  auth.exportData);

// Gestión de perfil (CSRF requerido en escritura)
router.put('/auth/profile',    mid.requireAuth, mid.csrfProtect, validate(schemas.updateProfile),  auth.updateProfile);
router.put('/auth/password',   mid.requireAuth, mid.csrfProtect, validate(schemas.changePassword), auth.changePassword);

// 2FA · gestión por el usuario logueado
router.get('/auth/2fa/status',  mid.requireAuth,                  auth.status2FA);
router.post('/auth/2fa/setup',  mid.requireAuth, mid.csrfProtect, auth.setup2FA);
router.post('/auth/2fa/enable', mid.requireAuth, mid.csrfProtect, auth.enable2FA);
router.post('/auth/2fa/disable',mid.requireAuth, mid.csrfProtect, auth.disable2FA);

// Transactions (auth + CSRF en escritura)
router.use('/transactions', mid.requireAuth, mid.apiLimiter);
router.get('/transactions',                                               tx.list);
router.get('/transactions/stats',                                         tx.stats);
router.post('/transactions',        mid.csrfProtect, validate(schemas.transaction), tx.create);
router.put('/transactions/:id',     mid.csrfProtect, validate(schemas.transaction), tx.update);
router.delete('/transactions/:id',  mid.csrfProtect,                     tx.remove);

// Admin (solo rol admin + CSRF)
router.use('/admin', mid.requireAuth, mid.requireAdmin);
router.get('/admin/users',              admin.listUsers);
router.put('/admin/users/:id/status',   mid.csrfProtect, admin.toggleStatus);

module.exports = router;
