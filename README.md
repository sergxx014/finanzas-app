# FinanzasApp · Gestión Financiera Personal Segura

Aplicación web para el control de finanzas personales (ingresos, gastos, presupuestos y estadísticas), desarrollada con enfoque en **Desarrollo Web Seguro**. Proyecto final de la asignatura *Diseño y Desarrollo Web Seguro* (Universidad San Jorge, curso 2025-26).

---

## 📋 Tabla de contenidos
- [Descripción](#-descripción)
- [Stack tecnológico](#-stack-tecnológico)
- [Requisitos previos](#-requisitos-previos)
- [Instalación rápida con Docker](#-instalación-rápida-con-docker-recomendada)
- [Instalación manual sin Docker](#-instalación-manual-sin-docker)
- [Variables de entorno](#-variables-de-entorno)
- [Credenciales de prueba](#-credenciales-de-prueba)
- [Crear un usuario administrador](#-crear-un-usuario-administrador)
- [Ejecución de tests](#-ejecución-de-tests)
- [Auditoría de seguridad](#-auditoría-de-seguridad)
- [Funcionalidades](#-funcionalidades)
- [Seguridad implementada](#-seguridad-implementada)
- [Estructura del proyecto](#-estructura-del-proyecto)

---

## 📖 Descripción

FinanzasApp permite a un usuario:
- Registrar ingresos y gastos por categoría y fecha
- Definir presupuestos mensuales por categoría
- Visualizar gráficas de evolución mensual y desglose por categoría
- Exportar todos sus datos personales (RGPD art. 20)
- Eliminar su cuenta y datos (RGPD art. 17)

Existen dos roles: **usuario** (gestiona sus propias finanzas) y **administrador** (panel de gestión de usuarios con activación/desactivación).

---

## 🛠 Stack tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| Backend | Node.js 20 + Express 4 | Madurez del ecosistema, middlewares de seguridad consolidados |
| ORM | Sequelize 6 | Consultas parametrizadas automáticas, migraciones |
| Base de datos | MySQL 8 | Estabilidad, soporte de transacciones ACID |
| Sesiones | express-session + connect-session-sequelize | Persistencia en BD, sobrevive a reinicios |
| Auth | bcryptjs (12 rounds) | Estándar OWASP para hashing de contraseñas |
| Cabeceras | helmet 7 | CSP, HSTS, X-Frame-Options configurados |
| Validación | Joi 17 | Esquemas declarativos, `stripUnknown` para sanitización |
| Rate limiting | express-rate-limit 7 | Anti fuerza-bruta en login |
| Logging | winston 3 | Logs separados de aplicación y seguridad |
| Tests | jest + supertest | 146 tests de integración (autenticación, autorización, RGPD, CSRF, validación, etc.) |

---

## 📦 Requisitos previos

- **Node.js** ≥ 18 (recomendado 20+)
- **npm** ≥ 9
- **MySQL** 8.0 (o Docker para arrancarlo automáticamente)

---

## 🐳 Instalación rápida con Docker (recomendada)

Levanta el servidor web + MySQL en un solo paso:

```bash
git clone <url-del-repositorio>
cd finanzas-app

# 1. Configurar variables de entorno
cp .env.example .env
# Edita .env y cambia SESSION_SECRET por un valor aleatorio:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 2. Levantar la aplicación
docker-compose up -d --build

# La app está disponible en http://localhost:3007
```

Para detener:
```bash
sudo docker-compose down            # mantiene los datos
sudo docker-compose down -v         # elimina también los datos de MySQL
```

---

## 💻 Instalación manual (sin Docker)

```bash
# 1. Clonar e instalar dependencias
git clone <url-del-repositorio>
cd finanzas-app
npm install

# 2. Configurar .env
cp .env.example .env
# Edita .env con las credenciales de tu MySQL local

# 3. Asegúrate de que MySQL está corriendo y la BD existe
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS finanzas;"

# 4. Arrancar la app
npm start

# La app está disponible en http://localhost:3007
```

---

## ⚙️ Variables de entorno

Todas se documentan en `.env.example`. Las críticas:

| Variable | Descripción | Por defecto |
|---|---|---|
| `NODE_ENV` | `development` / `production` / `test` | `production` |
| `PORT` | Puerto HTTP | `3000` |
| `SESSION_SECRET` | **Obligatorio cambiar**. Cadena aleatoria 64+ chars | — |
| `COOKIE_SECURE` | `true` solo si sirves por HTTPS | `false` |
| `DB_HOST` | `db` en Docker, `127.0.0.1` en local | `127.0.0.1` |
| `DB_PORT` | Puerto de MySQL | `3306` |
| `DB_USER` / `DB_PASS` / `DB_NAME` | Credenciales MySQL | — |

---

## 🔑 Credenciales de prueba

La primera vez que arranques la app no hay usuarios. Tienes dos opciones:

**Opción A — Registrarte por la web** (rol `user`):
1. Ve a `http://localhost:3000/register`
2. Rellena el formulario. La contraseña debe tener mín. 8 chars, mayúscula, minúscula, número y símbolo (`@$!%*?&._-`).

**Opción B — Crear administrador por CLI:**
Ver siguiente sección.

---

## 👑 Crear un usuario administrador
El endpoint público de registro **nunca acepta `role: admin`** (es ignorado por la validación con `stripUnknown` para evitar escalada de privilegios desde la web). La creación de administradores se hace por línea de comandos:
```bash
node scripts/create-admin.js "Nombre del Admin" {email del admin (sin las llaves)}
```
El script pedirá la contraseña de forma interactiva (sin eco en pantalla) y la solicitará dos veces para confirmar.

El script:
- Crea el usuario con `role='admin'` y `active=true`
- Si el email ya existe, lo **promociona** a admin (no cambia su contraseña)
- Valida que la contraseña cumpla la política de complejidad
- **No acepta la contraseña como argumento** para evitar que quede expuesta en el historial de la shell o en `ps aux`

Tras crearlo, inicia sesión en `/login` y accede al panel en `/admin`.

## 🔐 Activar 2FA (verificación en dos pasos)

Cualquier usuario puede activar 2FA TOTP desde **Mi cuenta → 🔐 Seguridad**:

1. Pulsa **Activar 2FA**
2. Escanea el QR con tu app autenticadora:
   - Google Authenticator
   - Authy
   - 1Password
   - Microsoft Authenticator
   - cualquier app compatible con TOTP (RFC 6238)
3. Introduce el código de 6 dígitos que muestra la app para confirmar
4. A partir de ese momento, el login pide código TOTP además de contraseña

Para **desactivar** 2FA: Mi cuenta → 🔐 Seguridad → **Desactivar 2FA**. Requiere introducir tu contraseña actual como confirmación.

---

## 🧪 Ejecución de tests

```bash
npm test
```

El proyecto incluye **146 tests de integración** (Jest + Supertest) que cubren:
- Autenticación, login, registro, logout, rate limiting
- **2FA TOTP**: setup, activación, verificación, desactivación, bypass attempts
- **Edición de perfil** y **cambio de contraseña** (con 2FA opcional)
- CSRF, CORS, cabeceras de seguridad
- Validación de entrada (Joi, SQLi, XSS en JSON)
- Control de acceso (A01 OWASP), IDOR
- RGPD (export, eliminación de cuenta)
- Logging de eventos de seguridad
- Fingerprint de sesión

Los tests usan un mock de BD en memoria (no requieren MySQL).

---

## 🔍 Auditoría de seguridad

El script `audit.sh` ejecuta una batería de comprobaciones contra el servidor en ejecución:

```bash
./audit.sh        # con el servidor levantado en localhost:3007
```

Verifica cabeceras (CSP, HSTS, XFO, etc.), control de acceso, validación de entrada, rate limiting, CORS, páginas legales RGPD y limpieza de logs.

Otras herramientas usadas en la auditoría:
- `npm audit` — escaneo de vulnerabilidades en dependencias
- `sqlmap` — inyección SQL en endpoints expuestos
- `securityheaders.com` — análisis externo de cabeceras (cuando hay despliegue público)

---

## ⚡ Funcionalidades

**Usuario:**
- Registro / login / logout
- **2FA TOTP opcional** (compatible con Google Authenticator, Authy, 1Password, Microsoft Authenticator)
- **Edición de perfil** (nombre y correo electrónico)
- **Cambio de contraseña** (con verificación 2FA si está activa)
- CRUD de transacciones (ingresos y gastos)
- Filtros por tipo y categoría
- Presupuestos mensuales por categoría
- Gráficas de evolución y desglose
- Exportación de datos personales (RGPD art. 20)
- Eliminación de cuenta (RGPD art. 17)

**Administrador (rol `admin`):**
- Listado de todos los usuarios (sin exposición de hashes)
- Activación / desactivación de usuarios
- Acceso al panel `/admin`

---

## 🔒 Seguridad implementada

| Categoría | Implementación |
|---|---|
| **Autenticación** | bcrypt (12 rounds), sesión con expiración 24h, regeneración de ID en login, fingerprint de User-Agent, **2FA TOTP opcional (RFC 6238)** |
| **Rate limiting** | 5 intentos/minuto en login y verificación 2FA (anti fuerza-bruta) |
| **CSRF** | Token sincronizado por sesión + cookie SameSite=Lax |
| **XSS** | Escapado en salida (función `esc()` en frontend) + CSP `script-src 'self'` |
| **SQLi** | Sequelize con consultas parametrizadas + Joi validación de entrada |
| **OWASP A01** | Middleware `requireAuth` + `requireAdmin` server-side, comprobación de propiedad en transacciones |
| **OWASP A02** | Hashes nunca expuestos en respuestas API (atributos explícitos en Sequelize) |
| **OWASP A05** | Sin credenciales por defecto en `.env.example`, Docker corriendo como usuario no-root |
| **OWASP A06** | `npm audit` ejecutado en CI, `package-lock.json` versionado |
| **OWASP A08** | CSP estricta sin orígenes externos para scripts, lock files |
| **OWASP A09** | Logs separados `app.log` (info) y `security.log` (eventos sensibles) sin contraseñas ni hashes |
| **Cabeceras** | CSP, HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, X-Powered-By eliminado |
| **CORS** | Solo mismo origen; rechazo con 403 y log de `CORS_BLOCKED` |
| **RGPD** | Consentimiento explícito (art. 6), minimización (art. 5.1.c), supresión (art. 17), portabilidad (art. 20), páginas legales obligatorias |

---

## 📁 Estructura del proyecto

```
finanzas-app-main/
├── src/
│   ├── server.js              # Configuración Express, helmet, sesiones, rutas
│   ├── routes/
│   │   └── api.js             # Definición de endpoints /api/*
│   ├── controllers/
│   │   ├── authController.js  # Login, registro, logout, export, delete
│   │   ├── txController.js    # CRUD de transacciones + stats
│   │   └── adminController.js # Listado y activación de usuarios
│   ├── middleware/
│   │   └── auth.js            # requireAuth, requireAdmin, csrfProtect, rate limiters
│   └── utils/
│       ├── db.js              # Modelos Sequelize (User, Transaction, Consent)
│       ├── logger.js          # Winston logger (security.log + app.log)
│       └── validators.js      # Esquemas Joi
├── public/                    # HTML, CSS, JS del frontend
├── tests/
│   └── api.test.js            # 146 tests de integración
├── scripts/
│   └── create-admin.js        # CLI para crear/promocionar admins
├── docker-compose.yml         # Stack completo (web + MySQL)
├── Dockerfile                 # Imagen del servidor (usuario no-root)
├── audit.sh                   # Script de auditoría de seguridad
├── .env.example               # Plantilla de variables de entorno
└── .gitignore                 # Excluye .env, logs, secretos
```

---

## Acceso desde dispositivos móviles en red local

Al acceder desde un móvil por IP local (ej. `http://192.168.1.X:3007`), 
es posible que los estilos CSS no carguen correctamente.

**Causa:** La cabecera `Strict-Transport-Security (HSTS)` configurada por 
Helmet indica al navegador que el sitio solo debe servirse por HTTPS. 
Al acceder por HTTP en red local, el navegador bloquea los recursos estáticos 
por política de seguridad.

**Solución en desarrollo:** Acceder desde el mismo equipo en 
`http://localhost:3007`, donde el navegador no aplica HSTS.

**En producción** este comportamiento es el correcto: la app debe servirse 
por HTTPS con un certificado SSL válido, momento en el que HSTS protege 
activamente contra ataques man-in-the-middle.

## 📜 Licencia y autoría

Proyecto académico individual · Curso 2025-26
Universidad San Jorge · 3.º Doble grado en Ingeniería informática y Ingeniería de la Ciberseguridad
Asignatura: Diseño y Desarrollo Web Seguro
