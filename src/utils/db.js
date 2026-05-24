'use strict';
const { Sequelize, DataTypes } = require('sequelize');
const logger = require('./logger');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'finanzas',
  process.env.DB_USER || 'root',
  process.env.DB_PASS || 'secret',
  {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    dialect: 'mysql',
    logging: false,
  }
);

const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, primaryKey: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true },
  hash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, defaultValue: 'user' },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastLogin: { type: DataTypes.DATE },
  // ── 2FA TOTP (RFC 6238) ─────────────────────────────────────
  totpSecret:  { type: DataTypes.STRING, allowNull: true },
  totpEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  // ── Reset de contraseña ──────────────────────────────────────
  passwordResetToken:   { type: DataTypes.STRING(64), allowNull: true },
  passwordResetExpires: { type: DataTypes.DATE,        allowNull: true },
});

const Transaction = sequelize.define('Transaction', {
  id: { type: DataTypes.UUID, primaryKey: true },
  userId: { type: DataTypes.UUID, allowNull: false },
  type: { type: DataTypes.ENUM('income', 'expense'), allowNull: false },
  amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  category: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.STRING },
  date: { type: DataTypes.DATEONLY, allowNull: false },
}, {
  indexes: [
    { fields: ['userId'] },
    { fields: ['date'] },
    { fields: ['category'] }
  ]
});

const Consent = sequelize.define('Consent', {
  userId: { type: DataTypes.UUID },
  email: { type: DataTypes.STRING },
  cookieConsent: { type: DataTypes.BOOLEAN },
  privacyConsent: { type: DataTypes.BOOLEAN },
  ip: { type: DataTypes.STRING },
  ua: { type: DataTypes.STRING },
});

User.hasMany(Transaction, { foreignKey: 'userId', onDelete: 'CASCADE' });
Transaction.belongsTo(User, { foreignKey: 'userId' });

User.hasOne(Consent, { foreignKey: 'userId', onDelete: 'CASCADE' });
Consent.belongsTo(User, { foreignKey: 'userId' });

(async () => {
  let retries = 5;
  while (retries > 0) {
    try {
      await sequelize.authenticate();
      await sequelize.sync({ alter: true }); // Sincroniza esquemas automáticamente
      logger.info('Conectado a MySQL exitosamente con Sequelize y tablas creadas.');
      break;
    } catch (error) {
      logger.error(`No se pudo conectar a MySQL. Reintentos restantes: ${retries - 1}`, { msg: error.message });
      retries -= 1;
      await new Promise(res => setTimeout(res, 5000)); // Esperar 5 segundos antes de reintentar
    }
  }
})();

module.exports = { sequelize, User, Transaction, Consent };
