# Modelo de amenazas (Threat Model)

Análisis básico de las principales amenazas contra FinanzasApp y las mitigaciones implementadas. Cubre la categoría **OWASP A04 · Insecure Design** del Top 10 (2021).

---

## Activos a proteger

| Activo | Confidencialidad | Integridad | Disponibilidad |
|---|---|---|---|
| Credenciales (hash de contraseña) | 🔴 Crítica | 🔴 Crítica | 🟡 Media |
| Sesiones de usuario | 🔴 Crítica | 🟡 Media | 🟡 Media |
| Datos personales (nombre, email) | 🟠 Alta | 🟠 Alta | 🟡 Media |
| Transacciones financieras | 🟠 Alta | 🔴 Crítica | 🟠 Alta |
| Panel de administración | 🔴 Crítica | 🔴 Crítica | 🟡 Media |

---

## Actores de amenaza

1. **Usuario externo no autenticado** — intenta acceder a recursos protegidos o explotar la página de login.
2. **Usuario autenticado malintencionado** — intenta acceder a datos de otros usuarios (IDOR) o escalar privilegios a admin.
3. **Atacante con control de red parcial** — intenta interceptar cookies, hacer CSRF o MITM en conexiones no cifradas.
4. **Bots automatizados** — fuerza bruta sobre login, scraping, escaneo de vulnerabilidades.

---

## Amenazas identificadas y mitigaciones

### 1. Robo de credenciales por fuerza bruta sobre el login

| | |
|---|---|
| **Vector** | Bot prueba miles de combinaciones email/contraseña |
| **Impacto** | Acceso no autorizado a cuenta de usuario |
| **Mitigaciones** | • Rate limiting: máximo 5 intentos/minuto por IP (`src/middleware/auth.js`)<br>• Mensaje genérico "Credenciales incorrectas" (no revela si el email existe → previene user enumeration)<br>• bcrypt con 12 rounds (≈250ms por hash, ralentiza ataques offline si se filtra la BD)<br>• Política de contraseñas: mín. 8 chars con mayús/minus/número/símbolo<br>• **2FA TOTP opcional** (RFC 6238): aunque la contraseña se filtre, el atacante necesita el dispositivo del usuario |
| **Riesgo residual** | Muy bajo. Con 2FA activo el ataque online es inviable. |

### 2. Escalada de privilegios a administrador

| | |
|---|---|
| **Vector** | Usuario manipula el campo `role` en el formulario de registro |
| **Impacto** | Acceso al panel admin, lectura de todos los usuarios, desactivación masiva |
| **Mitigaciones** | • Joi con `stripUnknown: true` elimina campos no declarados antes de llegar al controlador<br>• El esquema de registro **no incluye** `role` → si se envía, se descarta<br>• En el `User.create()` el rol se fuerza explícitamente a `'user'`<br>• La creación de administradores solo es posible vía CLI (`scripts/create-admin.js`) |
| **Riesgo residual** | Muy bajo. Requeriría acceso al servidor (CLI o BD directa). |

### 3. Secuestro de sesión (Session Hijacking)

| | |
|---|---|
| **Vector** | Atacante obtiene la cookie `sid` (XSS, sniff en HTTP, malware en cliente) |
| **Impacto** | Suplantación completa del usuario hasta que la sesión caduque |
| **Mitigaciones** | • Cookie con flags `HttpOnly` (no accesible por JS) + `SameSite=Lax` (anti-CSRF) + `Secure` en HTTPS<br>• CSP `script-src 'self'` impide inyectar scripts que roben la cookie<br>• **Fingerprint de sesión**: si el User-Agent cambia tras el login, la sesión se invalida y se registra `SESSION_HIJACK_DETECTED` en `security.log`<br>• Sesión con expiración máxima de 24h<br>• Sesiones persistidas en MySQL (`connect-session-sequelize`): el servidor puede invalidar cualquier sesión globalmente |
| **Riesgo residual** | Bajo. Un atacante en la misma red sobre HTTP podría sniffar la cookie, pero el flag `Secure` + HSTS en producción lo impide. |

### 3 bis. Bypass del 2FA

| | |
|---|---|
| **Vector** | Atacante intenta saltarse la verificación TOTP (fuerza bruta del código, llamadas directas a /api/auth/2fa/verify sin haber pasado el paso 1, replay attack del mismo token) |
| **Impacto** | Acceso completo a la cuenta aunque tenga 2FA |
| **Mitigaciones** | • Verificación TOTP requiere pre-sesión con `awaiting2FA=true` (creada solo tras login correcto)<br>• Rate limiter de login también aplica a `/api/auth/2fa/verify` → máx. 5 intentos/min<br>• Ventana TOTP de solo ±30s (`window: 1`) reduce el espacio de búsqueda<br>• Códigos de 6 dígitos generados por algoritmo HMAC-SHA1 (RFC 6238) → 10⁶ combinaciones por ventana de tiempo<br>• Todos los fallos se registran como `2FA_VERIFY_FAIL` en `security.log` con `userId` e IP<br>• La pre-sesión se invalida tras éxito (regenerate) → no permite replay |
| **Riesgo residual** | Muy bajo. Brute-force online inviable por rate limit; brute-force offline imposible (sin acceso al secret). |

### 4. Inyección SQL (SQLi)

| | |
|---|---|
| **Vector** | Payloads SQL en campos de formulario (email de login, descripción de transacción, etc.) |
| **Impacto** | Exfiltración de toda la BD, modificación de registros, bypass de login |
| **Mitigaciones** | • Sequelize ORM con queries parametrizadas en TODAS las operaciones (no hay concatenación de strings)<br>• Joi rechaza emails malformados con status 400 ANTES de llegar a la BD<br>• Joi valida tipos: `amount` debe ser número, `date` debe ser ISO, `type` debe estar en enum<br>• Probado con sqlmap → 0 vectores de inyección encontrados |
| **Riesgo residual** | Muy bajo. Cualquier query nueva debe seguir usando Sequelize. |

### 5. Cross-Site Scripting (XSS)

| | |
|---|---|
| **Vector** | Usuario inyecta `<script>` en campo `description` de transacción o `name` de registro |
| **Impacto** | Robo de cookies de otros usuarios, defacement, phishing |
| **Mitigaciones** | • **Escapado en salida**: función `esc()` en `public/js/dashboard.js:164` convierte caracteres especiales a entidades HTML antes de insertarlas en el DOM<br>• Uso de `textContent` en lugar de `innerHTML` donde es posible<br>• CSP `script-src 'self'` impide ejecutar scripts inline aunque llegaran al DOM<br>• Responses de la API son `Content-Type: application/json` (el navegador no las renderiza como HTML) |
| **Riesgo residual** | Bajo. La defensa en profundidad (escapado + CSP) hace que un fallo de escapado en una vista no sea explotable. |

### 6. Cross-Site Request Forgery (CSRF)

| | |
|---|---|
| **Vector** | Atacante crea una página que hace un POST a `/api/transactions` desde otro origen mientras la víctima está logueada |
| **Impacto** | Creación/modificación/borrado de transacciones sin consentimiento |
| **Mitigaciones** | • Token CSRF sincronizado: cada sesión tiene un token aleatorio de 32 bytes que debe enviarse en la cabecera `x-csrf-token` para cualquier petición de modificación (POST/PUT/DELETE)<br>• Cookie con `SameSite=Lax` impide envío automático en peticiones cross-site<br>• Validación CORS rechaza cualquier `Origin` distinto del propio servidor (HTTP 403) |
| **Riesgo residual** | Muy bajo. Doble protección (token + SameSite). |

### 7. Acceso a recursos de otros usuarios (IDOR)

| | |
|---|---|
| **Vector** | Usuario autenticado modifica el `:id` en `/api/transactions/:id` para ver/editar transacciones ajenas |
| **Impacto** | Acceso a información financiera de terceros, modificación de datos ajenos |
| **Mitigaciones** | • Todas las queries de transacciones filtran por `userId: req.session.userId`<br>• Si la transacción no pertenece al usuario, la query devuelve 0 filas → 404<br>• Intentos se registran como `TX_UPDATE_UNAUTH` o similar en `security.log` |
| **Riesgo residual** | Bajo. El filtro por userId es sistemático en todos los controladores. |

### 8. Denegación de servicio por payloads grandes

| | |
|---|---|
| **Vector** | Atacante envía POST con body de varios MB |
| **Impacto** | Consumo excesivo de RAM, posible OOM del proceso |
| **Mitigaciones** | • `express.json({ limit: '10kb' })` rechaza cualquier body mayor con HTTP 413<br>• Joi rechaza strings excesivamente largos según `max()` en cada campo |
| **Riesgo residual** | Bajo. Detrás de nginx en producción se pondría además un límite a nivel de proxy. |

---

## Amenazas no mitigadas / aceptadas

### Compromiso del servidor / hosting
Si un atacante consigue acceso root a la máquina, todas las defensas a nivel de aplicación son insuficientes. La defensa aquí es operativa (firewall, fail2ban, actualizaciones de SO) y queda fuera del alcance del proyecto académico.

### Ataques físicos sobre el dispositivo del usuario
Un atacante con acceso físico a un dispositivo logueado puede operar como el usuario. Fuera del alcance.

### Phishing
Un usuario que entrega voluntariamente sus credenciales a una web suplantadora no puede protegerse desde el servidor. Se mitiga con educación y, en producción, con DMARC/SPF para el dominio.

---

## Resumen

| OWASP Top 10 (2021) | Amenazas cubiertas en este modelo |
|---|---|
| A01 · Broken Access Control | Amenazas 2, 7 |
| A02 · Cryptographic Failures | Amenaza 1 (bcrypt) |
| A03 · Injection | Amenazas 4, 5 |
| A04 · Insecure Design | Este documento completo |
| A05 · Security Misconfiguration | Cookies seguras, CSP, helmet, Dockerfile como usuario no-root |
| A07 · Auth Failures | Amenazas 1, 3, 3bis (2FA) |
| A08 · Software and Data Integrity | CSP, `package-lock.json`, `npm audit` |
| A09 · Logging | Eventos de seguridad en `security.log` |
