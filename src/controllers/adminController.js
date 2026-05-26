'use strict';
const db     = require('../utils/db');
const logger = require('../utils/logger');

/* GET /api/admin/users — lista todos los usuarios (sin hash) */
async function listUsers(req, res) {
  try {
    const users = await db.User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'active', 'lastLogin', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    logger.info('ADMIN_LIST_USERS', { adminId: req.session.userId });
    res.json({ ok: true, data: users });
  } catch (e) {
    res.status(500).json({ ok: false, errors: ['Error al obtener usuarios.'] });
  }
}

/* PUT /api/admin/users/:id/status — activa o desactiva un usuario */
async function toggleStatus(req, res) {
  try {
    const { id } = req.params;
    if (id === req.session.userId) {
      return res.status(400).json({ ok: false, errors: ['No puedes desactivarte a ti mismo.'] });
    }
    const user = await db.User.findOne({ where: { id } });
    if (!user) return res.status(404).json({ ok: false, errors: ['Usuario no encontrado.'] });

    user.active = !user.active;
    await user.save();
    logger.info('ADMIN_TOGGLE_STATUS', { adminId: req.session.userId, targetId: id, active: user.active });
    res.json({ ok: true, active: user.active });
  } catch (e) {
    res.status(500).json({ ok: false, errors: ['Error al actualizar.'] });
  }
}

module.exports = { listUsers, toggleStatus };
