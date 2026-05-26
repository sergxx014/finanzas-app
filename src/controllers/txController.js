'use strict';
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const db     = require('../utils/db');
const logger = require('../utils/logger');

const CAT_INCOME  = ['Salario','Freelance','Inversiones','Ventas','Alquiler','Regalo','Reembolso','Otros ingresos'];
const CAT_EXPENSE = ['Vivienda','Alimentación','Transporte','Salud','Educación','Ocio','Ropa','Tecnología','Seguros','Restaurantes','Suscripciones','Otros gastos'];

async function list(req, res) {
  try {
    const uid = req.session.userId;
    const { type, category, from, to } = req.query;
    const q = { userId: uid };
    if (type && ['income','expense'].includes(type)) q.type = type;
    if (category) {
      const allCats = [...CAT_INCOME, ...CAT_EXPENSE];
      if (allCats.includes(category)) q.category = category;
      // categoría fuera del listado permitido → se ignora silenciosamente
    }
    if (from || to) {
      q.date = {};
      if (from) q.date[Op.gte] = from;
      if (to)   q.date[Op.lte] = to;
    }
    const txs = await db.Transaction.findAll({ where: q, order: [['date', 'DESC']] });
    res.json({ ok: true, data: txs });
  } catch (e) { res.status(500).json({ ok: false, errors: ['Error al obtener transacciones.'] }); }
}

async function create(req, res) {
  try {
    const uid = req.session.userId;
    const { type, amount, category, description, date } = req.body;
    const valid = type === 'income' ? CAT_INCOME : CAT_EXPENSE;
    if (!valid.includes(category)) return res.status(400).json({ ok: false, errors: ['Categoría inválida.'] });
    const tx = { id: uuidv4(), userId: uid, type, amount: parseFloat(amount), category, description: description || '', date };
    await db.Transaction.create(tx);
    logger.info('TX_CREATE', { userId: uid, type, amount });
    // Encontrar y devolver con id autogenerado por seq
    res.status(201).json({ ok: true, data: tx });
  } catch (e) { res.status(500).json({ ok: false, errors: ['Error al crear.'] }); }
}

async function update(req, res) {
  try {
    const uid = req.session.userId;
    const { id } = req.params;
    const existing = await db.Transaction.findOne({ where: { id, userId: uid } });
    if (!existing) { logger.security('TX_UPDATE_UNAUTH', { uid, id }); return res.status(404).json({ ok: false, errors: ['No encontrado.'] }); }
    const { type, amount, category, description, date } = req.body;
    const valid = type === 'income' ? CAT_INCOME : CAT_EXPENSE;
    if (!valid.includes(category)) return res.status(400).json({ ok: false, errors: ['Categoría inválida.'] });
    await db.Transaction.update({ type, amount: parseFloat(amount), category, description: description || '', date }, { where: { id, userId: uid } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, errors: ['Error al actualizar.'] }); }
}

async function remove(req, res) {
  try {
    const uid = req.session.userId;
    const { id } = req.params;
    const n = await db.Transaction.destroy({ where: { id, userId: uid } });
    if (!n) { logger.security('TX_DEL_UNAUTH', { uid, id }); return res.status(404).json({ ok: false, errors: ['No encontrado.'] }); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, errors: ['Error al eliminar.'] }); }
}

async function stats(req, res) {
  try {
    const uid = req.session.userId;
    const { month } = req.query;
    const q = { userId: uid };
    if (month) q.date = { [Op.gte]: `${month}-01`, [Op.lte]: `${month}-31` };
    const txs = await db.Transaction.findAll({ where: q });
    const inc = txs.filter(t => t.type === 'income').reduce((s,t) => s + parseFloat(t.amount), 0);
    const exp = txs.filter(t => t.type === 'expense').reduce((s,t) => s + parseFloat(t.amount), 0);
    const byCategory = {};
    txs.forEach(t => {
      if (!byCategory[t.category]) byCategory[t.category] = { income: 0, expense: 0 };
      byCategory[t.category][t.type === 'income' ? 'income' : 'expense'] += parseFloat(t.amount);
    });
    // Monthly trend last 6 months
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }
    const all = await db.Transaction.findAll({ where: { userId: uid, date: { [Op.gte]: months[0] + '-01' } } });
    const trend = {};
    months.forEach(m => { trend[m] = { income: 0, expense: 0 }; });
    all.forEach(t => { 
      const m = String(t.date).slice(0,7); 
      if (trend[m]) trend[m][t.type === 'income' ? 'income' : 'expense'] += parseFloat(t.amount); 
    });
    res.json({ ok: true, data: { totalIncome: inc, totalExpense: exp, balance: inc - exp, count: txs.length, byCategory, trend } });
  } catch (e) { res.status(500).json({ ok: false, errors: ['Error en estadísticas.'] }); }
}

module.exports = { list, create, update, remove, stats, CAT_INCOME, CAT_EXPENSE };
