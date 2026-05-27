#!/bin/bash
# ─────────────────────────────────────────────────────────────
# FinanzasApp · Script de auditoría automatizada
#
# Uso:   ./audit.sh
# Requiere el servidor levantado (por defecto http://localhost:3000)
# ─────────────────────────────────────────────────────────────

HOST="${HOST:-http://localhost:3000}"
PASS="\e[32mPASS\e[0m"
FAIL="\e[31mFAIL\e[0m"
TOTAL=0
PASSED=0

echo "=== AUDITORÍA FINANZASAPP ==="
echo "Host: $HOST"
echo ""

HEADERS_FILE=$(mktemp)
curl -sI "$HOST/" > "$HEADERS_FILE"

check_header_present() {
  local desc=$1 pattern=$2
  TOTAL=$((TOTAL+1))
  if grep -qi "$pattern" "$HEADERS_FILE"; then
    echo -e "[$PASS] $desc"
    PASSED=$((PASSED+1))
  else
    echo -e "[$FAIL] $desc"
  fi
}

check_header_absent() {
  local desc=$1 pattern=$2
  TOTAL=$((TOTAL+1))
  if grep -qi "$pattern" "$HEADERS_FILE"; then
    echo -e "[$FAIL] $desc"
  else
    echo -e "[$PASS] $desc"
    PASSED=$((PASSED+1))
  fi
}

check_status() {
  local desc=$1 expected=$2 url=$3
  TOTAL=$((TOTAL+1))
  local actual
  actual=$(curl -so /dev/null -w '%{http_code}' "$url")
  if [ "$actual" = "$expected" ]; then
    echo -e "[$PASS] $desc (→ $actual)"
    PASSED=$((PASSED+1))
  else
    echo -e "[$FAIL] $desc (esperado: $expected, obtenido: $actual)"
  fi
}

check_post_status() {
  local desc=$1 expected=$2 url=$3 data=$4
  TOTAL=$((TOTAL+1))
  local actual
  actual=$(curl -so /dev/null -w '%{http_code}' -X POST \
    -H "Content-Type: application/json" -d "$data" "$url")
  if [ "$actual" = "$expected" ]; then
    echo -e "[$PASS] $desc (→ $actual)"
    PASSED=$((PASSED+1))
  else
    echo -e "[$FAIL] $desc (esperado: $expected, obtenido: $actual)"
  fi
}

echo "--- Cabeceras de seguridad (sección 3.3) ---"
check_header_present "Content-Security-Policy"   "content-security-policy"
check_header_present "X-Content-Type-Options"    "x-content-type-options"
check_header_present "X-Frame-Options: DENY"     "x-frame-options: deny"
check_header_present "Strict-Transport-Security" "strict-transport-security"
check_header_present "Permissions-Policy"        "permissions-policy"
check_header_present "Referrer-Policy"           "referrer-policy"
check_header_absent  "X-Powered-By eliminado"    "x-powered-by"

echo ""
echo "--- Control de acceso sin sesión (OWASP A01) ---"
check_status "GET /api/transactions sin sesión"          "401" "$HOST/api/transactions"
check_status "GET /api/admin/users sin sesión"           "401" "$HOST/api/admin/users"
check_status "GET /api/auth/export sin sesión"           "401" "$HOST/api/auth/export"
check_status "GET /api/transactions/stats sin sesión"    "401" "$HOST/api/transactions/stats"

echo ""
echo "--- Páginas legales RGPD (sección 3.4) ---"
check_status "GET /privacidad"   "200" "$HOST/privacidad"
check_status "GET /cookies"      "200" "$HOST/cookies"
check_status "GET /aviso-legal"  "200" "$HOST/aviso-legal"

echo ""
echo "--- Validación de entrada (OWASP A03) ---"
check_post_status "Email malformado en login" "400" \
  "$HOST/api/auth/login" '{"email":"no-es-email","password":"x"}'
check_post_status "SQLi en email de login"    "400" \
  "$HOST/api/auth/login" "{\"email\":\"' OR 1=1 --\",\"password\":\"x\"}"

echo ""
echo "--- Rate limiting login (sección 3.1) ---"
RESULTS=()
for i in {1..6}; do
  CODE=$(curl -so /dev/null -w '%{http_code}' -X POST \
    -H "Content-Type: application/json" \
    -d '{"email":"noexiste@test.com","password":"mal"}' \
    "$HOST/api/auth/login")
  RESULTS+=("$CODE")
done
TOTAL=$((TOTAL+1))
if [ "${RESULTS[0]}" = "401" ]; then
  echo -e "[$PASS] Intento 1 → 401 (credenciales incorrectas)"
  PASSED=$((PASSED+1))
else
  echo -e "[$FAIL] Intento 1 (esperado: 401, obtenido: ${RESULTS[0]})"
fi
TOTAL=$((TOTAL+1))
if [ "${RESULTS[5]}" = "429" ]; then
  echo -e "[$PASS] Intento 6 → 429 (rate limit activado)"
  PASSED=$((PASSED+1))
else
  echo -e "[$FAIL] Intento 6 (esperado: 429, obtenido: ${RESULTS[5]})"
fi

echo ""
echo "--- CORS restrictivo (sección 3.3) ---"
TOTAL=$((TOTAL+1))
STATUS=$(curl -so /dev/null -w '%{http_code}' \
  -H "Origin: https://atacante.com" \
  "$HOST/api/transactions")
if [ "$STATUS" = "403" ]; then
  echo -e "[$PASS] Origin externo bloqueado → 403"
  PASSED=$((PASSED+1))
else
  echo -e "[$FAIL] Origin externo (esperado: 403, obtenido: $STATUS)"
fi

echo ""
echo "--- Body excesivamente grande (DoS prevention) ---"
TOTAL=$((TOTAL+1))
BIG_PAYLOAD=$(printf '{"email":"%s@x.com","password":"x"}' "$(printf 'a%.0s' {1..11000})")
STATUS=$(curl -so /dev/null -w '%{http_code}' -X POST \
  -H "Content-Type: application/json" \
  --data-binary "$BIG_PAYLOAD" \
  "$HOST/api/auth/login")
if [ "$STATUS" = "413" ] || [ "$STATUS" = "400" ]; then
  echo -e "[$PASS] Body >10KB rechazado (→ $STATUS)"
  PASSED=$((PASSED+1))
else
  echo -e "[$FAIL] Body >10KB (esperado: 413/400, obtenido: $STATUS)"
fi

echo ""
echo "--- Logs de seguridad (OWASP A09) ---"
if [ -f logs/security.log ]; then
  TOTAL=$((TOTAL+1))
  echo -e "[$PASS] logs/security.log existe"
  PASSED=$((PASSED+1))

  TOTAL=$((TOTAL+1))
  SENSITIVE=$(grep -iE 'password|hash|\$2[abxy]\$' logs/security.log 2>/dev/null | head -1)
  if [ -z "$SENSITIVE" ]; then
    echo -e "[$PASS] security.log no contiene datos sensibles"
    PASSED=$((PASSED+1))
  else
    echo -e "[$FAIL] security.log contiene datos sensibles"
  fi
else
  echo -e "[!] logs/security.log no encontrado (la app aún no ha registrado eventos)"
fi

rm -f "$HEADERS_FILE"

echo ""
echo "═══════════════════════════════════════"
echo "  Resultado: $PASSED / $TOTAL comprobaciones superadas"
echo "═══════════════════════════════════════"

# Exit code: 0 si todo pasó, 1 si hubo fallos
[ "$PASSED" -eq "$TOTAL" ] && exit 0 || exit 1
