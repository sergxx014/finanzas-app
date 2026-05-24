'use strict';
const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '../../logs');
fs.mkdirSync(logDir, { recursive: true });

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'security.log'), level: 'warn' }),
    new winston.transports.File({ filename: path.join(logDir, 'app.log') }),
    new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) }),
  ],
});

module.exports = {
  info:     (m, meta = {}) => logger.info(m, meta),
  warn:     (m, meta = {}) => logger.warn(m, meta),
  error:    (m, meta = {}) => logger.error(m, meta),
  security: (event, meta = {}) => logger.warn(`[SEC] ${event}`, meta),
};
