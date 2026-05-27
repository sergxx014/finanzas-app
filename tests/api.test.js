'use strict';

jest.setTimeout(60000);

// ── Mocks ANTES de importar la app ───────────────────────────────────────────

jest.mock('../src/utils/logger', () => ({
  info:     jest.fn(),
  warn:     jest.fn(),
  error:    jest.fn(),
  security: jest.fn(),
}));

jest.mock('../src/utils/db', () => {
  const bcryptMock = require('bcryptjs');

  // IDs fijos — deben coincidir con los del scope externo
  const ADMIN_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const USER_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const USER2_ID  = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const TX_ID     = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  // Rounds bajos para velocidad en tests; el test de rounds comprueba el hash
  // generado por la app (que usa 12), no los seeds del mock
  const ADMIN_HASH = bcryptMock.hashSync('Admin@12345', 4);
  const USER_HASH  = bcryptMock.hashSync('User@12345', 4);

  let users, transactions;

  function reset() {
    // Resetea el rate limiter de login entre tests para evitar 429 espurios
    try { require('../src/middleware/auth').__resetLimiters(); } catch (_) {}
    users = {
      [ADMIN_ID]: {
        id: ADMIN_ID, name: 'Admin Test', email: 'admin@test.com',
        hash: ADMIN_HASH, role: 'admin', active: true, lastLogin: null,
        createdAt: new Date('2026-01-01'),
        save: jest.fn().mockResolvedValue(true),
        destroy: jest.fn().mockImplementation(function () {
          delete users[ADMIN_ID]; return Promise.resolve();
        }),
      },
      [USER_ID]: {
        id: USER_ID, name: 'User Test', email: 'user@test.com',
        hash: USER_HASH, role: 'user', active: true, lastLogin: null,
        createdAt: new Date('2026-01-01'),
        save: jest.fn().mockResolvedValue(true),
        destroy: jest.fn().mockImplementation(function () {
          delete users[USER_ID]; return Promise.resolve();
        }),
      },
      [USER2_ID]: {
        id: USER2_ID, name: 'User2 Test', email: 'user2@test.com',
        hash: USER_HASH, role: 'user', active: true, lastLogin: null,
        createdAt: new Date('2026-01-01'),
        save: jest.fn().mockResolvedValue(true),
        destroy: jest.fn().mockImplementation(function () {
          delete users[USER2_ID]; return Promise.resolve();
        }),
      },
    };
    transactions = {
      [TX_ID]: {
        id: TX_ID, userId: USER_ID, type: 'income', amount: '1000.00',
        category: 'Salario', description: 'Sueldo enero', date: '2026-01-15',
      },
    };
  }

  reset();

  const mockTxObj = {
    commit:   jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };

  const User = {
    findOne: jest.fn().mockImplementation(async ({ where }) => {
      if (where.email) return Object.values(users).find(u => u.email === where.email) || null;
      if (where.id)    return users[where.id] || null;
      return null;
    }),
    findAll: jest.fn().mockImplementation(async ({ attributes } = {}) =>
      Object.values(users).map(u => {
        if (!attributes) return u;
        return attributes.reduce((acc, k) => { acc[k] = u[k]; return acc; }, {});
      })
    ),
    create: jest.fn().mockImplementation(async (data) => {
      const inst = {
        ...data, createdAt: new Date(),
        save:    jest.fn().mockResolvedValue(true),
        destroy: jest.fn().mockImplementation(() => { delete users[data.id]; return Promise.resolve(); }),
      };
      users[data.id] = inst;
      return inst;
    }),
    destroy: jest.fn().mockImplementation(async ({ where }) => {
      if (where.id && users[where.id]) { delete users[where.id]; return 1; }
      return 0;
    }),
  };

  const Transaction = {
    findAll: jest.fn().mockImplementation(async ({ where = {} } = {}) =>
      Object.values(transactions).filter(t => !where.userId || t.userId === where.userId)
    ),
    findOne: jest.fn().mockImplementation(async ({ where }) =>
      Object.values(transactions).find(t => t.id === where.id && t.userId === where.userId) || null
    ),
    create: jest.fn().mockImplementation(async (data) => {
      transactions[data.id] = data; return data;
    }),
    update: jest.fn().mockImplementation(async (data, { where }) => {
      const t = Object.values(transactions).find(t => t.id === where.id && t.userId === where.userId);
      if (t) Object.assign(t, data);
      return [t ? 1 : 0];
    }),
    destroy: jest.fn().mockImplementation(async ({ where }) => {
      const t = Object.values(transactions).find(t => t.id === where.id && t.userId === where.userId);
      if (t) { delete transactions[t.id]; return 1; }
      return 0;
    }),
  };

  const Consent = {
    create: jest.fn().mockResolvedValue({}),
  };

  const sequelize = {
    transaction: jest.fn().mockResolvedValue(mockTxObj),
  };

  return { sequelize, User, Transaction, Consent, __reset: reset };
});

// ── Imports tras mocks ────────────────────────────────────────────────────────

const request = require('supertest');
const app     = require('../src/server');
const logger  = require('../src/utils/logger');
const db      = require('../src/utils/db');

// ── Constantes compartidas ────────────────────────────────────────────────────

const ADMIN_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER2_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TX_ID    = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const VALID_TX = {
  type: 'income', amount: 500, category: 'Salario',
  description: 'Test', date: '2026-05-01',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loginAs(email, password) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password });
  return agent;
}

async function loginWithCsrf(email, password) {
  const agent = await loginAs(email, password);
  const me    = await agent.get('/api/auth/me');
  return { agent, csrfToken: me.body.csrfToken };
}

// ── Reset entre tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  db.__reset();
  jest.clearAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. CABECERAS DE SEGURIDAD — sección 3.3
// ═════════════════════════════════════════════════════════════════════════════

describe('3.3 · Cabeceras de seguridad', () => {
  let res;
  beforeEach(async () => { res = await request(app).get('/'); });

  it('Content-Security-Policy: default-src self', () => {
    expect(res.headers['content-security-policy']).toMatch(/default-src\s+'self'/);
  });

  it('CSP: script-src sin unsafe-inline', () => {
    const csp = res.headers['content-security-policy'];
    // Si script-src contiene 'self' sin unsafe-inline cumple el requisito
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('CSP: frame-ancestors none (anti-clickjacking)', () => {
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors\s+'none'/);
  });

  it('CSP: object-src none (sin plugins Flash/Java)', () => {
    expect(res.headers['content-security-policy']).toMatch(/object-src\s+'none'/);
  });

  it('CSP: base-uri para bloquear inyección de <base>', () => {
    expect(res.headers['content-security-policy']).toMatch(/base-uri/);
  });

  it('CSP: form-action self (formularios solo a mismo origen)', () => {
    expect(res.headers['content-security-policy']).toMatch(/form-action/);
  });

  it('X-Content-Type-Options: nosniff', () => {
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('X-Frame-Options: DENY o CSP frame-ancestors (anti-clickjacking)', () => {
    const xfo = (res.headers['x-frame-options'] || '').toUpperCase();
    const csp = res.headers['content-security-policy'] || '';
    expect(xfo === 'DENY' || csp.includes("frame-ancestors 'none'")).toBe(true);
  });

  it('Strict-Transport-Security presente', () => {
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('X-Powered-By eliminado (no fingerprinting de stack)', () => {
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('Permissions-Policy configurada', () => {
    expect(res.headers['permissions-policy']).toBeDefined();
  });

  it('Referrer-Policy presente', () => {
    expect(res.headers['referrer-policy']).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CORS — sección 3.3
// ═════════════════════════════════════════════════════════════════════════════

describe('3.3 · CORS restrictivo', () => {
  it('Bloquea petición con Origin externo (403)', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Origin', 'https://evil.com');
    expect(res.statusCode).toBe(403);
  });

  it('Evento CORS_BLOCKED registrado en log de seguridad', async () => {
    await request(app).get('/api/auth/me').set('Origin', 'https://attacker.com');
    expect(logger.security).toHaveBeenCalledWith('CORS_BLOCKED', expect.any(Object));
  });

  it('Permite petición sin cabecera Origin (mismo servidor)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toBe(200);
  });

  it('No devuelve Access-Control-Allow-Origin: * en producción', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. AUTENTICACIÓN — sección 3.1
// ═════════════════════════════════════════════════════════════════════════════

describe('3.1 · Login', () => {
  it('Credenciales correctas → 200 + ok:true + redirect', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'User@12345' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.redirect).toBe('/dashboard');
  });

  it('Contraseña incorrecta → 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'WrongPass@1' });
    expect(res.statusCode).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it('Usuario inexistente → 401 con mensaje genérico (no user-enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'noexiste@test.com', password: 'User@12345' });
    expect(res.statusCode).toBe(401);
    expect(res.body.errors[0]).toMatch(/credenciales/i);
  });

  it('Cookie de sesión tiene flag HttpOnly', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'User@12345' });
    const cookie = [].concat(res.headers['set-cookie']).join('; ');
    expect(cookie.toLowerCase()).toMatch(/httponly/);
  });

  it('Cookie de sesión tiene flag SameSite', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'User@12345' });
    const cookie = [].concat(res.headers['set-cookie']).join('; ');
    expect(cookie.toLowerCase()).toMatch(/samesite/);
  });

  it('Cookie de sesión tiene expiración ≤ 24 h (86400 s)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'User@12345' });
    const cookie = [].concat(res.headers['set-cookie']).join('; ');
    const match  = cookie.match(/max-age=(\d+)/i);
    if (match) expect(parseInt(match[1], 10)).toBeLessThanOrEqual(86400);
    else       expect(cookie.toLowerCase()).toMatch(/expires=/);
  });

  it('Evento LOGIN_FAIL registrado en security.log', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'WrongPass@1' });
    expect(logger.security).toHaveBeenCalledWith('LOGIN_FAIL', expect.objectContaining({ ip: expect.any(String) }));
  });

  it('Respuesta de login no expone el hash de contraseña', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'User@12345' });
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });
});

describe('3.1 · Rate limiting en login (brute-force)', () => {
  it('6º intento en el mismo minuto → 429', async () => {
    const agent = request.agent(app);
    for (let i = 0; i < 5; i++) {
      await agent.post('/api/auth/login').send({ email: 'user@test.com', password: 'Bad@Pass1' });
    }
    const res = await agent.post('/api/auth/login').send({ email: 'user@test.com', password: 'Bad@Pass1' });
    expect(res.statusCode).toBe(429);
  });
});

describe('3.1 · Sesión — /api/auth/me', () => {
  it('Sin sesión: auth=false, csrfToken vacío', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.body.auth).toBe(false);
    expect(res.body.csrfToken).toBe('');
  });

  it('Con sesión: auth=true, nombre, rol y csrfToken presentes', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/auth/me');
    expect(res.body.auth).toBe(true);
    expect(res.body.name).toBe('User Test');
    expect(res.body.role).toBe('user');
    expect(res.body.csrfToken.length).toBeGreaterThan(20);
  });
});

describe('3.1 · Logout invalida sesión en el servidor', () => {
  it('Tras logout la sesión ya no sirve para acceder a rutas protegidas', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const before = await agent.get('/api/transactions');
    expect(before.statusCode).toBe(200);

    await agent.post('/api/auth/logout').set('x-csrf-token', csrfToken);

    const after = await agent.get('/api/transactions');
    expect(after.statusCode).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. REGISTRO — 3.1 + A03 (validación)
// ═════════════════════════════════════════════════════════════════════════════

describe('3.1 · Registro', () => {
  const base = {
    name: 'Nuevo Usuario', email: 'nuevo@test.com',
    password: 'Nuevo@12345', confirmPassword: 'Nuevo@12345',
    privacyConsent: true, cookieConsent: true,
  };

  it('Registro correcto → 200 + ok:true', async () => {
    const res = await request(app).post('/api/auth/register').send(base);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('Hash guardado NO es el password en texto plano', async () => {
    await request(app).post('/api/auth/register').send(base);
    const saved = db.User.create.mock.calls[0]?.[0];
    expect(saved).toBeDefined();
    expect(saved.hash).not.toBe(base.password);
  });

  it('Hash guardado tiene formato bcrypt ($2b$)', async () => {
    await request(app).post('/api/auth/register').send(base);
    const saved = db.User.create.mock.calls[0]?.[0];
    expect(saved.hash).toMatch(/^\$2[aby]\$/);
  });

  it('Hash usa al menos 12 rounds', async () => {
    await request(app).post('/api/auth/register').send(base);
    const saved = db.User.create.mock.calls[0]?.[0];
    const match = saved.hash.match(/^\$2[aby]\$(\d+)\$/);
    expect(match).not.toBeNull();
    expect(parseInt(match[1], 10)).toBeGreaterThanOrEqual(12);
  });

  it('Email ya registrado → 409', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...base, email: 'user@test.com' });
    expect(res.statusCode).toBe(409);
  });

  it('Contraseña sin mayúscula → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ ...base, email: 'x@test.com', password: 'weak@12345', confirmPassword: 'weak@12345' });
    expect(res.statusCode).toBe(400);
  });

  it('Contraseña sin símbolo especial → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ ...base, email: 'x@test.com', password: 'Weak12345', confirmPassword: 'Weak12345' });
    expect(res.statusCode).toBe(400);
  });

  it('Contraseña menos de 8 caracteres → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ ...base, email: 'x@test.com', password: 'Ab@1', confirmPassword: 'Ab@1' });
    expect(res.statusCode).toBe(400);
  });

  it('Contraseñas no coinciden → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ ...base, email: 'x@test.com', confirmPassword: 'Diferente@1' });
    expect(res.statusCode).toBe(400);
  });

  it('Sin privacyConsent → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ ...base, email: 'x@test.com', privacyConsent: false });
    expect(res.statusCode).toBe(400);
  });

  it('Sin cookieConsent → 400', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ ...base, email: 'x@test.com', cookieConsent: false });
    expect(res.statusCode).toBe(400);
  });

  it('La contraseña NO aparece en la respuesta del servidor', async () => {
    const res = await request(app).post('/api/auth/register').send(base);
    expect(JSON.stringify(res.body)).not.toContain(base.password);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. PROTECCIÓN CSRF — sección 3.3
// ═════════════════════════════════════════════════════════════════════════════

describe('3.3 · Protección CSRF', () => {
  it('POST /api/transactions sin token CSRF → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.post('/api/transactions').send(VALID_TX);
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/transactions con token CSRF incorrecto → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent
      .post('/api/transactions')
      .set('x-csrf-token', 'token_falso_12345')
      .send(VALID_TX);
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/transactions con token CSRF correcto → 201', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send(VALID_TX);
    expect(res.statusCode).toBe(201);
  });

  it('DELETE /api/auth/account sin CSRF → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.delete('/api/auth/account');
    expect(res.statusCode).toBe(403);
  });

  it('PUT /api/transactions/:id sin CSRF → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.put(`/api/transactions/${TX_ID}`).send(VALID_TX);
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /api/transactions/:id sin CSRF → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.delete(`/api/transactions/${TX_ID}`);
    expect(res.statusCode).toBe(403);
  });

  it('Evento CSRF_REJECTED queda en security.log', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    await agent.post('/api/transactions').send(VALID_TX);
    expect(logger.security).toHaveBeenCalledWith('CSRF_REJECTED', expect.any(Object));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. A01 · CONTROL DE ACCESO
// ═════════════════════════════════════════════════════════════════════════════

describe('A01 · Rutas protegidas sin sesión → 401', () => {
  const protectedRoutes = [
    ['GET',    '/api/transactions'],
    ['GET',    '/api/transactions/stats'],
    ['GET',    '/api/auth/export'],
    ['GET',    '/api/admin/users'],
  ];

  protectedRoutes.forEach(([method, path]) => {
    it(`${method} ${path} → 401`, async () => {
      const res = await request(app)[method.toLowerCase()](path);
      expect(res.statusCode).toBe(401);
    });
  });

  it('UNAUTH queda en security.log', async () => {
    await request(app).get('/api/transactions');
    expect(logger.security).toHaveBeenCalledWith('UNAUTH', expect.any(Object));
  });
});

describe('A01 · Rutas admin — control de rol', () => {
  it('Usuario regular no puede acceder a /api/admin/users → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/admin/users');
    expect(res.statusCode).toBe(403);
  });

  it('Admin sí puede acceder a /api/admin/users → 200', async () => {
    const agent = await loginAs('admin@test.com', 'Admin@12345');
    const res   = await agent.get('/api/admin/users');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('Acceso admin denegado queda en security.log', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    await agent.get('/api/admin/users');
    expect(logger.security).toHaveBeenCalledWith('ADMIN_ACCESS_DENIED', expect.any(Object));
  });
});

describe('A01 · Propiedad de recursos (IDOR)', () => {
  it('User2 no puede editar transacción de User1 → 404', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user2@test.com', 'User@12345');
    const res = await agent
      .put(`/api/transactions/${TX_ID}`)
      .set('x-csrf-token', csrfToken)
      .send(VALID_TX);
    expect(res.statusCode).toBe(404);
  });

  it('User2 no puede borrar transacción de User1 → 404', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user2@test.com', 'User@12345');
    const res = await agent
      .delete(`/api/transactions/${TX_ID}`)
      .set('x-csrf-token', csrfToken);
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/transactions solo devuelve transacciones del usuario autenticado', async () => {
    const agent = await loginAs('user2@test.com', 'User@12345');
    const res   = await agent.get('/api/transactions');
    expect(res.statusCode).toBe(200);
    (res.body.data || []).forEach(t => expect(t.userId).toBe(USER2_ID));
  });

  it('Intento de acceso IDOR en update queda en security.log', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user2@test.com', 'User@12345');
    await agent.put(`/api/transactions/${TX_ID}`).set('x-csrf-token', csrfToken).send(VALID_TX);
    expect(logger.security).toHaveBeenCalledWith('TX_UPDATE_UNAUTH', expect.any(Object));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. A02 · FALLOS CRIPTOGRÁFICOS
// ═════════════════════════════════════════════════════════════════════════════

describe('A02 · Hash de contraseñas no expuesto en API', () => {
  it('Respuesta de login no contiene hash bcrypt', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'User@12345' });
    expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
  });

  it('Lista de usuarios (admin) no incluye campo hash ni password', async () => {
    const agent = await loginAs('admin@test.com', 'Admin@12345');
    const res   = await agent.get('/api/admin/users');
    (res.body.data || []).forEach(u => {
      expect(u.hash).toBeUndefined();
      expect(u.password).toBeUndefined();
    });
  });

  it('Export de datos personales no incluye hash de contraseña', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/auth/export');
    const body  = JSON.stringify(res.body);
    expect(body).not.toMatch(/\$2[aby]\$/);
    expect(body).not.toContain('"hash"');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. A03 · INYECCIÓN — validación de entrada
// ═════════════════════════════════════════════════════════════════════════════

describe('A03 · Validación de entrada y protección contra inyección', () => {
  it('SQLi en email de login rechazado → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: "' OR '1'='1' --", password: 'anything' });
    expect(res.statusCode).toBe(400);
  });

  it('Email malformado en login → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: 'pass' });
    expect(res.statusCode).toBe(400);
  });

  it('Tipo de transacción SQLi rechazado → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, type: "' UNION SELECT * FROM users --" });
    expect(res.statusCode).toBe(400);
  });

  it('Amount negativo rechazado → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, amount: -999 });
    expect(res.statusCode).toBe(400);
  });

  it('Amount cero rechazado → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, amount: 0 });
    expect(res.statusCode).toBe(400);
  });

  it('Amount excesivamente grande rechazado → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, amount: 99999999 });
    expect(res.statusCode).toBe(400);
  });

  it('Fecha no ISO rechazada → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, date: 'no-es-fecha' });
    expect(res.statusCode).toBe(400);
  });

  it('Categoría no permitida en transacción → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, category: '<script>alert(1)</script>' });
    expect(res.statusCode).toBe(400);
  });

  it('Campos extra son descartados (stripUnknown), no se reflejan en respuesta', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, campoMalicioso: '<img src=x onerror=alert(1)>', isAdmin: true });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).not.toHaveProperty('campoMalicioso');
    expect(res.body.data).not.toHaveProperty('isAdmin');
  });

  it('Body excesivamente grande (>10 kb) rechazado → 413 o 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a'.repeat(11000) + '@x.com', password: 'x' });
    expect([400, 413]).toContain(res.statusCode);
  });

  it('Campo description con HTML no se refleja ejecutable (JSON response)', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, description: '<script>alert("xss")</script>' });
    expect(res.statusCode).toBe(201);
    // La respuesta es JSON — el contenido no se renderiza como HTML
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. CRUD COMPLETO DE TRANSACCIONES
// ═════════════════════════════════════════════════════════════════════════════

describe('CRUD · Transacciones', () => {
  it('GET /api/transactions → 200 + array', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/transactions');
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/transactions crea transacción income → 201', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send(VALID_TX);
    expect(res.statusCode).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({ type: 'income', amount: 500, category: 'Salario' });
  });

  it('POST /api/transactions crea transacción expense → 201', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ type: 'expense', amount: 200, category: 'Alimentación', description: '', date: '2026-05-01' });
    expect(res.statusCode).toBe(201);
  });

  it('PUT /api/transactions/:id actualiza transacción propia → 200', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .put(`/api/transactions/${TX_ID}`)
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, amount: 999 });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('DELETE /api/transactions/:id elimina transacción propia → 200', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .delete(`/api/transactions/${TX_ID}`)
      .set('x-csrf-token', csrfToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /api/transactions/stats devuelve estructura completa', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/transactions/stats');
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('totalIncome');
    expect(res.body.data).toHaveProperty('totalExpense');
    expect(res.body.data).toHaveProperty('balance');
    expect(res.body.data).toHaveProperty('byCategory');
    expect(res.body.data).toHaveProperty('trend');
    expect(res.body.data).toHaveProperty('count');
  });

  it('Filtro ?type=income solo devuelve ingresos', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/transactions?type=income');
    expect(res.statusCode).toBe(200);
    (res.body.data || []).forEach(t => expect(t.type).toBe('income'));
  });

  it('Categoría inválida para income → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, category: 'CategoríaFalsa' });
    expect(res.statusCode).toBe(400);
  });

  it('description con más de 500 chars → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent
      .post('/api/transactions')
      .set('x-csrf-token', csrfToken)
      .send({ ...VALID_TX, description: 'x'.repeat(501) });
    expect(res.statusCode).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. ADMIN — gestión de usuarios
// ═════════════════════════════════════════════════════════════════════════════

describe('Admin · Gestión de usuarios', () => {
  it('Lista de usuarios devuelve campos esperados sin hash', async () => {
    const agent = await loginAs('admin@test.com', 'Admin@12345');
    const res   = await agent.get('/api/admin/users');
    expect(res.statusCode).toBe(200);
    const user = res.body.data[0];
    ['id', 'name', 'email', 'role', 'active'].forEach(f => expect(user).toHaveProperty(f));
    expect(user.hash).toBeUndefined();
  });

  it('Admin puede activar/desactivar usuario → 200 + active devuelto', async () => {
    const { agent, csrfToken } = await loginWithCsrf('admin@test.com', 'Admin@12345');
    const res = await agent
      .put(`/api/admin/users/${USER_ID}/status`)
      .set('x-csrf-token', csrfToken);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('active');
  });

  it('Admin no puede desactivarse a sí mismo → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('admin@test.com', 'Admin@12345');
    const res = await agent
      .put(`/api/admin/users/${ADMIN_ID}/status`)
      .set('x-csrf-token', csrfToken);
    expect(res.statusCode).toBe(400);
  });

  it('Usuario desactivado no puede iniciar sesión → 401', async () => {
    const { agent, csrfToken } = await loginWithCsrf('admin@test.com', 'Admin@12345');
    await agent.put(`/api/admin/users/${USER_ID}/status`).set('x-csrf-token', csrfToken);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'User@12345' });
    expect(res.statusCode).toBe(401);
  });

  it('PUT /api/admin/users/:id/status sin CSRF → 403', async () => {
    const agent = await loginAs('admin@test.com', 'Admin@12345');
    const res   = await agent.put(`/api/admin/users/${USER_ID}/status`);
    expect(res.statusCode).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. A08 · Integridad de software (CSP)
// ═════════════════════════════════════════════════════════════════════════════

describe('A08 · Integridad de software y datos', () => {
  it('CSP no permite scripts de CDN externos sin restricción', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).not.toMatch(/script-src[^;]*https?:\/\/cdn\./);
    expect(csp).not.toMatch(/script-src[^;]*\*/);
  });

  it('CSP connect-src solo permite mismo origen', async () => {
    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/connect-src\s+'self'/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. A09 · Logging y monitorización
// ═════════════════════════════════════════════════════════════════════════════

describe('A09 · Logging de eventos de seguridad', () => {
  it('Login fallido → LOGIN_FAIL en security.log con IP', async () => {
    await request(app).post('/api/auth/login').send({ email: 'user@test.com', password: 'Bad@1' });
    expect(logger.security).toHaveBeenCalledWith('LOGIN_FAIL', expect.objectContaining({ ip: expect.any(String) }));
  });

  it('Acceso no autenticado → UNAUTH en security.log', async () => {
    await request(app).get('/api/transactions');
    expect(logger.security).toHaveBeenCalledWith('UNAUTH', expect.any(Object));
  });

  it('Acceso admin denegado → ADMIN_ACCESS_DENIED en security.log', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    await agent.get('/api/admin/users');
    expect(logger.security).toHaveBeenCalledWith('ADMIN_ACCESS_DENIED', expect.any(Object));
  });

  it('Token CSRF rechazado → CSRF_REJECTED en security.log', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    await agent.post('/api/transactions').send(VALID_TX);
    expect(logger.security).toHaveBeenCalledWith('CSRF_REJECTED', expect.any(Object));
  });

  it('Origin externo bloqueado → CORS_BLOCKED en security.log', async () => {
    await request(app).get('/api/auth/me').set('Origin', 'https://evil.example.com');
    expect(logger.security).toHaveBeenCalledWith('CORS_BLOCKED', expect.any(Object));
  });

  it('Login correcto → evento INFO registrado (no datos sensibles)', async () => {
    await request(app).post('/api/auth/login').send({ email: 'user@test.com', password: 'User@12345' });
    const calls = logger.info.mock.calls.map(c => JSON.stringify(c));
    // No debe haber contraseña ni hash en ningún log
    calls.forEach(c => {
      expect(c).not.toMatch(/User@12345/);
      expect(c).not.toMatch(/\$2[aby]\$/);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. RGPD — cumplimiento legal, sección 3.4
// ═════════════════════════════════════════════════════════════════════════════

describe('3.4 · RGPD y cumplimiento legal', () => {
  it('GET /privacidad → 200 (art. 6 RGPD — política de privacidad)', async () => {
    const res = await request(app).get('/privacidad');
    expect(res.statusCode).toBe(200);
  });

  it('GET /cookies → 200 (LSSI-CE art. 22.2)', async () => {
    const res = await request(app).get('/cookies');
    expect(res.statusCode).toBe(200);
  });

  it('GET /aviso-legal → 200', async () => {
    const res = await request(app).get('/aviso-legal');
    expect(res.statusCode).toBe(200);
  });

  it('DELETE /api/auth/account elimina cuenta y devuelve ok:true (art. 17 RGPD)', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.delete('/api/auth/account').set('x-csrf-token', csrfToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('Tras eliminar cuenta, la sesión queda invalidada en el servidor', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    await agent.delete('/api/auth/account').set('x-csrf-token', csrfToken);
    const res = await agent.get('/api/transactions');
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/export devuelve datos personales con Content-Disposition (art. 20 RGPD)', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/auth/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body).toHaveProperty('perfil');
    expect(res.body).toHaveProperty('transacciones');
    expect(res.body).toHaveProperty('exportado');
  });

  it('Export no incluye hash ni password (minimización art. 5.1.c RGPD)', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/auth/export');
    const body  = JSON.stringify(res.body);
    expect(body).not.toMatch(/\$2[aby]\$/);
    expect(body).not.toContain('"hash"');
    expect(body).not.toContain('"password"');
  });

  it('Registro requiere consentimiento explícito de privacidad', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test', email: 'noprivacy@test.com',
      password: 'Test@12345', confirmPassword: 'Test@12345',
      privacyConsent: false, cookieConsent: true,
    });
    expect(res.statusCode).toBe(400);
  });

  it('Registro guarda registro de consentimiento (Consent.create llamado)', async () => {
    await request(app).post('/api/auth/register').send({
      name: 'Nuevo', email: 'nuevo@test.com',
      password: 'Nuevo@12345', confirmPassword: 'Nuevo@12345',
      privacyConsent: true, cookieConsent: true,
    });
    expect(db.Consent.create).toHaveBeenCalledWith(
      expect.objectContaining({ cookieConsent: true, privacyConsent: true }),
      expect.any(Object)
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. Redirecciones y navegación
// ═════════════════════════════════════════════════════════════════════════════

describe('Páginas y redirecciones', () => {
  it('GET / sin sesión → 200 (landing page)', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
  });

  it('GET / con sesión → 302 /dashboard', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/').redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('GET /dashboard sin sesión → 302 /login', async () => {
    const res = await request(app).get('/dashboard').redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
  });

  it('GET /admin usuario regular → 302 /login', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/admin').redirects(0);
    expect(res.statusCode).toBe(302);
  });

  it('GET /admin como admin → 200', async () => {
    const agent = await loginAs('admin@test.com', 'Admin@12345');
    const res   = await agent.get('/admin');
    expect(res.statusCode).toBe(200);
  });

  it('Ruta inexistente → 404', async () => {
    const res = await request(app).get('/esto-no-existe');
    expect(res.statusCode).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. Detección de secuestro de sesión
// ═════════════════════════════════════════════════════════════════════════════

describe('Seguridad avanzada · Fingerprint de sesión', () => {
  it('Cambio de User-Agent tras login invalida la sesión → 401', async () => {
    // Login con UA específico
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('User-Agent', 'LegitBrowser/1.0')
      .send({ email: 'user@test.com', password: 'User@12345' });

    // Acceso con UA diferente (simula robo de cookie)
    const res = await agent
      .get('/api/transactions')
      .set('User-Agent', 'AttackerBrowser/9.9');

    expect(res.statusCode).toBe(401);
  });

  it('Secuestro de sesión detectado queda en security.log', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .set('User-Agent', 'LegitBrowser/1.0')
      .send({ email: 'user@test.com', password: 'User@12345' });

    await agent
      .get('/api/transactions')
      .set('User-Agent', 'AttackerBrowser/9.9');

    expect(logger.security).toHaveBeenCalledWith('SESSION_HIJACK_DETECTED', expect.any(Object));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3.1+ · 2FA (TOTP - RFC 6238) — seguridad para nota alta
// ═════════════════════════════════════════════════════════════════════════════

describe('3.1+ · 2FA TOTP — setup y activación', () => {
  it('GET /api/auth/2fa/status sin sesión → 401', async () => {
    const res = await request(app).get('/api/auth/2fa/status');
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/2fa/status con sesión → enabled:false por defecto', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.get('/api/auth/2fa/status');
    expect(res.statusCode).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('POST /api/auth/2fa/setup sin sesión → 401', async () => {
    const res = await request(app).post('/api/auth/2fa/setup');
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/auth/2fa/setup sin CSRF → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res   = await agent.post('/api/auth/2fa/setup');
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/auth/2fa/setup con CSRF → 200 + qr + secret', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrfToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(res.body.secret).toMatch(/^[A-Z2-7]+=*$/);  // base32
  });

  it('POST /api/auth/2fa/enable con token inválido (no numérico) → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.post('/api/auth/2fa/enable')
      .set('x-csrf-token', csrfToken)
      .send({ token: 'abc123' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/auth/2fa/enable sin haber hecho setup → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.post('/api/auth/2fa/enable')
      .set('x-csrf-token', csrfToken)
      .send({ token: '123456' });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/auth/2fa/enable con token TOTP correcto → 200 + activa 2FA', async () => {
    const speakeasy = require('speakeasy');
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');

    // 1. Setup
    const setupRes = await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrfToken);
    const secret = setupRes.body.secret;

    // 2. Generar token TOTP válido
    const token = speakeasy.totp({ secret, encoding: 'base32' });

    // 3. Activar
    const enableRes = await agent.post('/api/auth/2fa/enable')
      .set('x-csrf-token', csrfToken)
      .send({ token });
    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.body.ok).toBe(true);

    // 4. Status ahora dice enabled:true
    const statusRes = await agent.get('/api/auth/2fa/status');
    expect(statusRes.body.enabled).toBe(true);
  });

  it('POST /api/auth/2fa/enable con token TOTP incorrecto → 401', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrfToken);

    const res = await agent.post('/api/auth/2fa/enable')
      .set('x-csrf-token', csrfToken)
      .send({ token: '000000' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/auth/2fa/disable requiere contraseña correcta', async () => {
    const speakeasy = require('speakeasy');
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');

    const setupRes = await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrfToken);
    const token    = speakeasy.totp({ secret: setupRes.body.secret, encoding: 'base32' });
    await agent.post('/api/auth/2fa/enable').set('x-csrf-token', csrfToken).send({ token });

    // Contraseña incorrecta → 401
    const badRes = await agent.post('/api/auth/2fa/disable')
      .set('x-csrf-token', csrfToken)
      .send({ password: 'incorrecta' });
    expect(badRes.statusCode).toBe(401);

    // Contraseña correcta → 200 + desactiva
    const goodRes = await agent.post('/api/auth/2fa/disable')
      .set('x-csrf-token', csrfToken)
      .send({ password: 'User@12345' });
    expect(goodRes.statusCode).toBe(200);

    const statusRes = await agent.get('/api/auth/2fa/status');
    expect(statusRes.body.enabled).toBe(false);
  });

  it('Logs de seguridad — 2FA_ENABLED se registra', async () => {
    const speakeasy = require('speakeasy');
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const setupRes = await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrfToken);
    const token    = speakeasy.totp({ secret: setupRes.body.secret, encoding: 'base32' });
    await agent.post('/api/auth/2fa/enable').set('x-csrf-token', csrfToken).send({ token });
    expect(logger.info).toHaveBeenCalledWith('2FA_ENABLED', expect.any(Object));
  });
});

describe('3.1+ · 2FA TOTP — flujo de login con 2FA activo', () => {
  async function setupUserWith2FA() {
    const speakeasy = require('speakeasy');
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const setupRes = await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrfToken);
    const secret   = setupRes.body.secret;
    const token    = speakeasy.totp({ secret, encoding: 'base32' });
    await agent.post('/api/auth/2fa/enable').set('x-csrf-token', csrfToken).send({ token });
    // Logout para tener un usuario "limpio" con 2FA activo
    await agent.post('/api/auth/logout').set('x-csrf-token', csrfToken);
    return { secret };
  }

  it('Login de usuario con 2FA → no completa sesión, devuelve twoFactor:true', async () => {
    const { secret } = await setupUserWith2FA();
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'User@12345' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.twoFactor).toBe(true);
    expect(res.body.redirect).toBe('/login/2fa');

    // Aún no debería tener acceso a rutas protegidas
    const txRes = await agent.get('/api/transactions');
    expect(txRes.statusCode).toBe(401);
  });

  it('POST /api/auth/2fa/verify con código correcto → completa login', async () => {
    const speakeasy = require('speakeasy');
    const { secret } = await setupUserWith2FA();
    const agent = request.agent(app);

    // Paso 1: login con password
    await agent.post('/api/auth/login').send({ email: 'user@test.com', password: 'User@12345' });

    // Paso 2: verificación TOTP
    const token = speakeasy.totp({ secret, encoding: 'base32' });
    const verifyRes = await agent.post('/api/auth/2fa/verify').send({ token });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.ok).toBe(true);

    // Ahora sí tiene acceso completo
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.body.auth).toBe(true);
  });

  it('POST /api/auth/2fa/verify con código incorrecto → 401, sin acceso', async () => {
    const { secret } = await setupUserWith2FA();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'user@test.com', password: 'User@12345' });

    const verifyRes = await agent.post('/api/auth/2fa/verify').send({ token: '000000' });
    expect(verifyRes.statusCode).toBe(401);

    // Sigue sin acceso
    const txRes = await agent.get('/api/transactions');
    expect(txRes.statusCode).toBe(401);
  });

  it('POST /api/auth/2fa/verify sin pre-sesión awaiting2FA → 401', async () => {
    const res = await request(app).post('/api/auth/2fa/verify').send({ token: '123456' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /login/2fa redirige a /login si no hay pre-sesión', async () => {
    const res = await request(app).get('/login/2fa').redirects(0);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('GET /login/2fa devuelve la página si hay pre-sesión awaiting2FA', async () => {
    await setupUserWith2FA();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'user@test.com', password: 'User@12345' });
    const res = await agent.get('/login/2fa');
    expect(res.statusCode).toBe(200);
    expect(res.text).toMatch(/Verificación en dos pasos/);
  });

  it('Logs de seguridad — 2FA_VERIFY_FAIL registra intentos fallidos', async () => {
    await setupUserWith2FA();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'user@test.com', password: 'User@12345' });
    await agent.post('/api/auth/2fa/verify').send({ token: '000000' });
    expect(logger.security).toHaveBeenCalledWith('2FA_VERIFY_FAIL', expect.any(Object));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PERFIL · Edición de nombre y email
// ═════════════════════════════════════════════════════════════════════════════

describe('Perfil · Editar nombre y email', () => {
  it('PUT /api/auth/profile sin sesión → 401', async () => {
    const res = await request(app).put('/api/auth/profile').send({ name: 'X', email: 'x@y.com' });
    expect(res.statusCode).toBe(401);
  });

  it('PUT /api/auth/profile sin CSRF → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/profile').send({ name: 'Nuevo', email: 'nuevo@test.com' });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /api/auth/profile con datos válidos → 200', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/profile')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Nombre Nuevo', email: 'nuevoemail@test.com' });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('Nombre Nuevo');
    expect(res.body.email).toBe('nuevoemail@test.com');
  });

  it('PUT /api/auth/profile con email ya usado por otro usuario → 409', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/profile')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Nombre Valido', email: 'user2@test.com' });  // email ya existe
    expect(res.statusCode).toBe(409);
  });

  it('PUT /api/auth/profile con email malformado → 400 (validador)', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/profile')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'X', email: 'no-es-email' });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/auth/profile con nombre demasiado corto → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/profile')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'X', email: 'valid@test.com' });
    expect(res.statusCode).toBe(400);
  });

  it('Evento PROFILE_UPDATED se registra en log', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    await agent.put('/api/auth/profile')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Otro Nombre', email: 'otro@test.com' });
    expect(logger.info).toHaveBeenCalledWith('PROFILE_UPDATED', expect.any(Object));
  });

  it('Tras editar perfil, /api/auth/me devuelve los datos actualizados', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    await agent.put('/api/auth/profile')
      .set('x-csrf-token', csrfToken)
      .send({ name: 'Nuevo', email: 'nuevo@test.com' });
    const me = await agent.get('/api/auth/me');
    expect(me.body.name).toBe('Nuevo');
    expect(me.body.email).toBe('nuevo@test.com');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PERFIL · Cambio de contraseña (con 2FA opcional)
// ═════════════════════════════════════════════════════════════════════════════

describe('Perfil · Cambiar contraseña (sin 2FA)', () => {
  const VALID_NEW = 'Nueva@Pass99';

  it('PUT /api/auth/password sin sesión → 401', async () => {
    const res = await request(app).put('/api/auth/password').send({});
    expect(res.statusCode).toBe(401);
  });

  it('PUT /api/auth/password sin CSRF → 403', async () => {
    const agent = await loginAs('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/password').send({
      currentPassword: 'User@12345', newPassword: VALID_NEW, confirmPassword: VALID_NEW,
    });
    expect(res.statusCode).toBe(403);
  });

  it('Contraseña actual incorrecta → 401', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'mal', newPassword: VALID_NEW, confirmPassword: VALID_NEW });
    expect(res.statusCode).toBe(401);
    expect(logger.security).toHaveBeenCalledWith('PWD_CHANGE_BAD_CURRENT', expect.any(Object));
  });

  it('Nueva y confirmación no coinciden → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'User@12345', newPassword: VALID_NEW, confirmPassword: 'OtraDistinta@99' });
    expect(res.statusCode).toBe(400);
  });

  it('Nueva contraseña débil (sin símbolo) → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'User@12345', newPassword: 'NuevaPass99', confirmPassword: 'NuevaPass99' });
    expect(res.statusCode).toBe(400);
  });

  it('Nueva contraseña igual a la actual → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'User@12345', newPassword: 'User@12345', confirmPassword: 'User@12345' });
    expect(res.statusCode).toBe(400);
  });

  it('Cambio correcto sin 2FA → 200 + PWD_CHANGED en log', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'User@12345', newPassword: VALID_NEW, confirmPassword: VALID_NEW });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('PWD_CHANGED', expect.any(Object));
  });
});

describe('Perfil · Cambiar contraseña con 2FA activo (requiere TOTP)', () => {
  const VALID_NEW = 'Nueva@Pass99';
  const speakeasy = require('speakeasy');

  async function enable2FAForUser(agent, csrfToken) {
    const setupRes = await agent.post('/api/auth/2fa/setup').set('x-csrf-token', csrfToken);
    const secret = setupRes.body.secret;
    const token  = speakeasy.totp({ secret, encoding: 'base32' });
    await agent.post('/api/auth/2fa/enable').set('x-csrf-token', csrfToken).send({ token });
    return secret;
  }

  it('Cambio sin enviar totpToken cuando 2FA está activo → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    await enable2FAForUser(agent, csrfToken);

    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'User@12345', newPassword: VALID_NEW, confirmPassword: VALID_NEW });
    expect(res.statusCode).toBe(400);
    expect(res.body.errors[0]).toMatch(/2FA/);
  });

  it('Cambio con totpToken incorrecto → 401', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    await enable2FAForUser(agent, csrfToken);

    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'User@12345', newPassword: VALID_NEW, confirmPassword: VALID_NEW, totpToken: '000000' });
    expect(res.statusCode).toBe(401);
    expect(logger.security).toHaveBeenCalledWith('PWD_CHANGE_BAD_TOTP', expect.any(Object));
  });

  it('Cambio con totpToken correcto → 200', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    const secret = await enable2FAForUser(agent, csrfToken);

    const validTotp = speakeasy.totp({ secret, encoding: 'base32' });
    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'User@12345', newPassword: VALID_NEW, confirmPassword: VALID_NEW, totpToken: validTotp });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('totpToken con formato inválido (letras) → 400', async () => {
    const { agent, csrfToken } = await loginWithCsrf('user@test.com', 'User@12345');
    await enable2FAForUser(agent, csrfToken);

    const res = await agent.put('/api/auth/password')
      .set('x-csrf-token', csrfToken)
      .send({ currentPassword: 'User@12345', newPassword: VALID_NEW, confirmPassword: VALID_NEW, totpToken: 'abc123' });
    expect(res.statusCode).toBe(400);
  });
});
