'use strict';
const Joi = require('joi');

const register = Joi.object({
  name:            Joi.string().min(2).max(100).trim().required(),
  email:           Joi.string().email({ tlds: false }).lowercase().max(255).required(),
  password:        Joi.string().min(8).max(128).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._-])/).required().messages({
    'string.pattern.base': 'La contraseña debe incluir mayúscula, minúscula, número y un símbolo especial'
  }),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({ 'any.only': 'Las contraseñas no coinciden' }),
  privacyConsent:  Joi.boolean().valid(true).required().messages({ 'any.only': 'Debes aceptar la política de privacidad' }),
  cookieConsent:   Joi.boolean().valid(true).required().messages({ 'any.only': 'Debes aceptar la política de cookies' }),
});

const login = Joi.object({
  email:    Joi.string().email({ tlds: false }).lowercase().max(255).required(),
  password: Joi.string().max(128).required(),
});

const transaction = Joi.object({
  type:        Joi.string().valid('income', 'expense').required(),
  amount:      Joi.number().positive().precision(2).max(9999999).required(),
  category:    Joi.string().max(60).trim().required(),
  description: Joi.string().max(500).trim().allow('').optional(),
  date:        Joi.string().isoDate().required(),
});

const updateProfile = Joi.object({
  name:  Joi.string().min(2).max(100).trim().required(),
  email: Joi.string().email({ tlds: false }).lowercase().max(255).required(),
});

const changePassword = Joi.object({
  currentPassword: Joi.string().max(128).required(),
  newPassword:     Joi.string().min(8).max(128).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._-])/).required().messages({
    'string.pattern.base': 'La contraseña debe incluir mayúscula, minúscula, número y un símbolo especial',
  }),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({ 'any.only': 'Las contraseñas no coinciden' }),
  totpToken:       Joi.string().pattern(/^\d{6}$/).optional().allow('').messages({ 'string.pattern.base': 'El código 2FA debe tener 6 dígitos' }),
});

const forgotPassword = Joi.object({
  email: Joi.string().email({ tlds: false }).lowercase().max(255).required(),
});

const resetPassword = Joi.object({
  token:           Joi.string().hex().length(64).required(),
  newPassword:     Joi.string().min(8).max(128).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._-])/).required().messages({
    'string.pattern.base': 'La contraseña debe incluir mayúscula, minúscula, número y un símbolo especial',
  }),
  confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({ 'any.only': 'Las contraseñas no coinciden' }),
});

function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const msgs = error.details.map(d => d.message);
      return res.status(400).json({ ok: false, errors: msgs });
    }
    req.body = value;
    next();
  };
}

module.exports = { schemas: { register, login, transaction, updateProfile, changePassword, forgotPassword, resetPassword }, validate };
