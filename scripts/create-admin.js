'use strict';
/**
 * Script de creación de usuarios administradores.
 *
 * Uso:
 *   node scripts/create-admin.js <nombre> <email>
 *
 * Ejemplo:
 *   node scripts/create-admin.js "Admin" admin@finanzas.local
 *
 * El script pedirá la contraseña de forma interactiva (sin eco en pantalla).
 *
 * El endpoint público /api/auth/register nunca acepta el campo 'role' (Joi
 * lo elimina con stripUnknown), por lo que ningún atacante puede registrarse
 * como admin desde la web. La creación del primer admin se hace solo por CLI.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/utils/db');

const ROUNDS = 12;

function promptPassword(label) {
  return new Promise((resolve) => {
    process.stdout.write(label);
    let pwd = '';

    const onData = (ch) => {
      ch = ch.toString();
      if (ch === '\n' || ch === '\r') {
        process.stdout.write('\n');
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        resolve(pwd);
      } else if (ch === '\u0003') {
        process.exit(0);
      } else if (ch === '\x7f') {
        pwd = pwd.slice(0, -1);
      } else {
        pwd += ch;
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
  });
}

async function main() {
  const [name, email] = process.argv.slice(2);

  if (!name || !email) {
    console.error('\n❌ Faltan argumentos.\n');
    console.error('Uso: node scripts/create-admin.js <nombre> <email>');
    console.error('Ej.: node scripts/create-admin.js "Admin" admin@finanzas.local\n');
    process.exit(1);
  }

  const password = await promptPassword('Contraseña del admin: ');
  const confirm  = await promptPassword('Confirmar contraseña:  ');

  if (password !== confirm) {
    console.error('\n❌ Las contraseñas no coinciden.\n');
    process.exit(1);
  }

  // Validación mínima de password (idéntica a la del registro web)
  const passwordOk = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._\-]).{8,128}$/.test(password);
  if (!passwordOk) {
    console.error('\n❌ La contraseña debe tener mín. 8 caracteres con mayúscula, minúscula, número y símbolo (@$!%*?&._-).\n');
    process.exit(1);
  }

  // Esperar a que db.js complete la conexión (es lazy con reintentos)
  await new Promise(r => setTimeout(r, 3000));

  try {
    await db.sequelize.authenticate();
  } catch (e) {
    console.error('\n❌ No se pudo conectar a MySQL. Revisa .env y que MySQL esté corriendo.\n');
    console.error('   Detalle:', e.message, '\n');
    process.exit(1);
  }

  const existing = await db.User.findOne({ where: { email: email.toLowerCase() } });
  if (existing) {
    if (existing.role === 'admin') {
      console.log(`\nℹ️  ${email} ya es admin. Nada que hacer.\n`);
    } else {
      existing.role = 'admin';
      await existing.save();
      console.log(`\n✅ ${email} promocionado a admin.\n`);
    }
  } else {
    const hash = await bcrypt.hash(password, ROUNDS);
    await db.User.create({
      id:     uuidv4(),
      name,
      email:  email.toLowerCase(),
      hash,
      role:   'admin',
      active: true,
    });
    console.log(`\n✅ Admin creado: ${email}`);
    console.log(`   Inicia sesión en /login con esa contraseña.\n`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('\n❌ Error inesperado:', e.message, '\n');
  process.exit(1);
});
