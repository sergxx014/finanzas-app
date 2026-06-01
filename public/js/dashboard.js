/* FinanzasApp Dashboard — vanilla JS, sin inline event handlers (CSP strict) */
(function () {

var CAT_INC  = ['Salario','Freelance','Inversiones','Ventas','Alquiler','Regalo','Reembolso','Otros ingresos'];
var CAT_EXP  = ['Vivienda','Alimentación','Transporte','Salud','Educación','Ocio','Ropa','Tecnología','Seguros','Restaurantes','Suscripciones','Otros gastos'];
var COLORS   = ['#6366f1','#22c55e','#ef4444','#f59e0b','#3b82f6','#ec4899','#8b5cf6','#14b8a6','#f97316','#a855f7','#06b6d4','#84cc16'];
var TITLES   = { overview:'Resumen', transactions:'Transacciones', budgets:'Presupuestos', charts:'Gráficas', account:'Mi cuenta' };

var txType    = 'income';
var editId    = null;
var charts    = {};
var budgets   = JSON.parse(localStorage.getItem('fa_budgets') || '[]');
var csrfToken = null;

function lastDayOf(monthStr) {
  var parts = monthStr.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  return String(new Date(y, m, 0).getDate()).padStart(2, '0');
}

/* ─── init ─────────────────────────────────────────────── */
var now = new Date();
var monthFilter = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('month-filter').value = monthFilter;
  document.getElementById('month-filter').addEventListener('change', function () {
    monthFilter = this.value;
    loadSection(currentSection());
  });

  /* nav */
  document.querySelectorAll('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { goSection(this.dataset.section); });
  });
  document.getElementById('hamburger').addEventListener('click', function () {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('btn-new-tx').addEventListener('click', function () { openTxModal(null); });
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  /* tx modal */
  document.getElementById('btn-type-inc').addEventListener('click', function () { setTxType('income'); });
  document.getElementById('btn-type-exp').addEventListener('click', function () { setTxType('expense'); });
  document.getElementById('tx-close').addEventListener('click', closeTxModal);
  document.getElementById('tx-cancel').addEventListener('click', closeTxModal);
  document.getElementById('tx-save').addEventListener('click', saveTx);
  document.getElementById('tx-overlay').addEventListener('click', function (e) { if (e.target === this) closeTxModal(); });

  /* budget modal */
  document.getElementById('bud-close').addEventListener('click', closeBudModal);
  document.getElementById('bud-cancel').addEventListener('click', closeBudModal);
  document.getElementById('bud-save').addEventListener('click', saveBudget);
  document.getElementById('bud-overlay').addEventListener('click', function (e) { if (e.target === this) closeBudModal(); });

  /* esc */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeTxModal(); closeBudModal(); }
  });

  /* ── Delegación de eventos: reemplaza todos los onclick/onchange en HTML generado ── */
  document.addEventListener('click', handleDelegatedClick);
  document.addEventListener('change', handleDelegatedChange);

  loadMe();
  loadSection('overview');
});

/* ─── delegación global de clics ──────────────────────── */
function handleDelegatedClick(e) {
  var btn = e.target.closest('[data-action]');
  if (!btn) return;
  var action = btn.dataset.action;
  var id     = btn.dataset.id || null;

  switch (action) {
    case 'go-tx':       goSection('transactions');  break;
    case 'open-tx':     openTxModal(null);          break;
    case 'edit-tx':     openTxModal(id);            break;
    case 'del-tx':
      if (!confirm('¿Eliminar esta transacción?')) return;
      api('/api/transactions/' + id, { method: 'DELETE' }).then(function (d) {
        if (d.ok) { toast('Transacción eliminada'); loadSection(currentSection()); }
        else toast('Error al eliminar', 'err');
      });
      break;
    case 'open-bud': openBudModal(); break;
    case 'del-bud':
      budgets = budgets.filter(function (b) { return b.id !== id; });
      localStorage.setItem('fa_budgets', JSON.stringify(budgets));
      loadBudgets();
      toast('Presupuesto eliminado');
      break;
    case 'del-account':
      if (!confirm('⚠️ ¿Eliminar tu cuenta y TODOS tus datos permanentemente?')) return;
      if (!confirm('Última confirmación. Esta acción no se puede deshacer.')) return;
      api('/api/auth/account', { method: 'DELETE' }).then(function (d) {
        if (d.ok) { localStorage.removeItem('fa_budgets'); location.href = '/'; }
      });
      break;
    case 'setup-2fa':     start2FASetup();       break;
    case 'confirm-2fa':   confirm2FAEnable();    break;
    case 'cancel-2fa':    load2FAStatus();       break;
    case 'disable-2fa':   disable2FA();          break;
    case 'edit-profile':  showProfileForm();     break;
    case 'save-profile':  saveProfile();         break;
    case 'cancel-profile': hideProfileForm();    break;
    case 'show-pwd-form': showPwdForm();         break;
    case 'save-password': savePassword();        break;
    case 'cancel-pwd':    hidePwdForm();         break;
  }
}

/* ─── delegación global de cambios (selects) ──────────── */
function handleDelegatedChange(e) {
  if (e.target.dataset.action === 'reload-tx') loadTransactions();
}

/* ─── carga de usuario y token CSRF ───────────────────── */
function loadMe() {
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok || !d.auth) { location.href = '/login?expired=1'; return; }
      document.getElementById('s-name').textContent = d.name;
      csrfToken = d.csrfToken || null;
    })
    .catch(function () { location.href = '/login?expired=1'; });
}

/* ─── navigation ───────────────────────────────────────── */
function currentSection() {
  var active = document.querySelector('.nav-item.active');
  return active ? active.dataset.section : 'overview';
}

function goSection(s) {
  document.querySelectorAll('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.section === s); });
  document.querySelectorAll('.section').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById('sec-' + s).classList.add('active');
  document.getElementById('page-title').textContent = TITLES[s] || s;
  document.getElementById('sidebar').classList.remove('open');
  loadSection(s);
}

function loadSection(s) {
  switch (s) {
    case 'overview':     loadOverview();     break;
    case 'transactions': loadTransactions(); break;
    case 'budgets':      loadBudgets();      break;
    case 'charts':       loadCharts();       break;
    case 'account':      loadAccount();      break;
  }
}

/* ─── api helper (incluye CSRF en escrituras) ──────────── */
function api(url, opts) {
  opts = opts || {};
  opts.credentials = 'same-origin';
  opts.headers = opts.headers || {};
  if (opts.method && opts.method !== 'GET') {
    opts.headers['X-CSRF-Token'] = csrfToken || '';
    // Si hay body y no se ha indicado Content-Type, asumimos JSON
    if (opts.body && !opts.headers['Content-Type']) {
      opts.headers['Content-Type'] = 'application/json';
    }
  }
  return fetch(url, opts).then(function (r) {
    if (r.status === 401) { location.href = '/login?expired=1'; throw new Error('unauth'); }
    return r.json();
  });
}

/* ─── formatters ───────────────────────────────────────── */
function fmt(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
}
function fmtDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMonth(m) {
  return new Date(m + '-01').toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
}
function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ─── toast ────────────────────────────────────────────── */
function toast(msg, type) {
  var t = document.createElement('div');
  t.className = 'toast ' + (type || 'ok');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(function () { t.remove(); }, 3000);
}

/* ─── overview ─────────────────────────────────────────── */
function loadOverview() {
  api('/api/transactions/stats?month=' + monthFilter)
    .then(function (d) {
      if (!d.ok) return;
      var s = d.data;
      var balColor = s.balance >= 0 ? 'var(--green)' : 'var(--red)';
      document.getElementById('sec-overview').innerHTML =
        '<div class="stats-grid">' +
          '<div class="stat-card inc"><div class="stat-lbl">Ingresos</div><div class="stat-val">' + fmt(s.totalIncome) + '</div></div>' +
          '<div class="stat-card exp"><div class="stat-lbl">Gastos</div><div class="stat-val">' + fmt(s.totalExpense) + '</div></div>' +
          '<div class="stat-card bal"><div class="stat-lbl">Balance</div><div class="stat-val" style="color:' + balColor + '">' + fmt(s.balance) + '</div></div>' +
          '<div class="stat-card cnt"><div class="stat-lbl">Transacciones</div><div class="stat-val">' + s.count + '</div></div>' +
        '</div>' +
        '<div class="charts-grid">' +
          '<div class="chart-card"><div class="chart-title">Tendencia mensual</div><div class="chart-wrap"><canvas id="c-trend" role="img" aria-label="Tendencia mensual"></canvas></div></div>' +
          '<div class="chart-card"><div class="chart-title">Gastos por categoría</div><div class="chart-wrap"><canvas id="c-donut" role="img" aria-label="Gastos por categoría"></canvas></div></div>' +
        '</div>' +
        '<div class="table-card">' +
          '<div class="table-hd"><h3>Últimas transacciones</h3>' +
          '<button class="btn btn-ghost btn-sm" data-action="go-tx">Ver todas →</button></div>' +
          '<div id="recent-body"></div>' +
        '</div>';

      buildTrendChart(s.trend);
      buildDonutChart(s.byCategory);
      loadRecentTxs();
    });
}

function loadRecentTxs() {
  api('/api/transactions')
    .then(function (d) {
      if (!d.ok) return;
      var el = document.getElementById('recent-body');
      if (el) el.innerHTML = renderTxTable(d.data.slice(0, 5), true);
    });
}

/* ─── transactions ─────────────────────────────────────── */
function loadTransactions() {
  var url = '/api/transactions?';
  var ftype = document.getElementById('ft-type');
  var fcat  = document.getElementById('ft-cat');
  if (ftype && ftype.value) url += 'type=' + encodeURIComponent(ftype.value) + '&';
  if (fcat  && fcat.value)  url += 'category=' + encodeURIComponent(fcat.value) + '&';
  if (monthFilter) url += 'from=' + monthFilter + '-01&to=' + monthFilter + '-' + lastDayOf(monthFilter) + '&';

  api(url).then(function (d) {
    if (!d.ok) return;
    var allCats = CAT_INC.concat(CAT_EXP).sort().filter(function (v, i, a) { return a.indexOf(v) === i; });
    var catOpts = allCats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    var curType = (ftype && ftype.value) || '';
    var curCat  = (fcat  && fcat.value)  || '';

    document.getElementById('sec-transactions').innerHTML =
      '<div class="table-card">' +
        '<div class="table-hd">' +
          '<h3>Transacciones</h3>' +
          '<div class="filters">' +
            '<select class="fsel" id="ft-type" data-action="reload-tx"><option value="">Todos los tipos</option>' +
              '<option value="income"' + (curType === 'income' ? ' selected' : '') + '>Ingresos</option>' +
              '<option value="expense"' + (curType === 'expense' ? ' selected' : '') + '>Gastos</option>' +
            '</select>' +
            '<select class="fsel" id="ft-cat" data-action="reload-tx"><option value="">Todas las categorías</option>' + catOpts + '</select>' +
            '<button class="btn btn-primary btn-sm" data-action="open-tx">+ Añadir</button>' +
          '</div>' +
        '</div>' +
        '<div id="tx-body">' + renderTxTable(d.data, false) + '</div>' +
      '</div>';

    if (curCat && document.getElementById('ft-cat')) document.getElementById('ft-cat').value = curCat;
  });
}

function renderTxTable(txs, compact) {
  if (!txs || !txs.length) return '<div class="empty"><div class="empty-ico">📭</div>No hay transacciones todavía.</div>';
  var rows = txs.map(function (t) {
    var inc = t.type === 'income';
    return '<tr>' +
      '<td>' + fmtDate(t.date) + '</td>' +
      '<td><span class="badge badge-' + (inc ? 'inc' : 'exp') + '">' + (inc ? 'Ingreso' : 'Gasto') + '</span></td>' +
      '<td>' + esc(t.category) + '</td>' +
      '<td>' + esc(t.description || '—') + '</td>' +
      '<td class="' + (inc ? 'amt-inc' : 'amt-exp') + '">' + (inc ? '+' : '−') + fmt(t.amount) + '</td>' +
      (compact ? '' :
        '<td>' +
          '<button class="action-btn" data-action="edit-tx" data-id="' + esc(t.id) + '" aria-label="Editar">✏️</button> ' +
          '<button class="action-btn del" data-action="del-tx" data-id="' + esc(t.id) + '" aria-label="Eliminar">🗑</button>' +
        '</td>') +
    '</tr>';
  }).join('');
  return '<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th>Importe</th>' + (compact ? '' : '<th>Acciones</th>') + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

/* ─── budgets ──────────────────────────────────────────── */
function loadBudgets() {
  var mb = budgets.filter(function (b) { return b.month === monthFilter; });

  api('/api/transactions?from=' + monthFilter + '-01&to=' + monthFilter + '-' + lastDayOf(monthFilter))
    .then(function (d) {
      var txs = d.ok ? d.data : [];
      var html = '';
      if (!mb.length) {
        html = '<div class="empty"><div class="empty-ico">🎯</div>Sin presupuestos. ¡Crea uno para controlar tus gastos!</div>';
      } else {
        html = '<div class="budget-grid">' + mb.map(function (b) {
          var spent = txs.filter(function (t) { return t.type === 'expense' && t.category === b.category; }).reduce(function (s, t) { return s + parseFloat(t.amount); }, 0);
          var pct   = b.amount > 0 ? Math.min((spent / b.amount) * 100, 100) : 0;
          var cls   = pct >= 100 ? 'bar-over' : pct >= 80 ? 'bar-warn' : 'bar-ok';
          var ico   = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
          return '<div class="budget-card">' +
            '<div class="bud-top">' +
              '<div><div class="bud-cat">' + ico + ' ' + esc(b.category) + '</div><div class="bud-amts">' + fmt(spent) + ' / ' + fmt(b.amount) + '</div></div>' +
              '<button class="action-btn del" data-action="del-bud" data-id="' + esc(b.id) + '" aria-label="Eliminar presupuesto">🗑</button>' +
            '</div>' +
            '<div class="bar-bg"><div class="bar-fill ' + cls + '" style="width:' + pct.toFixed(1) + '%"></div></div>' +
            '<div class="bar-pct">' + pct.toFixed(0) + '% usado</div>' +
          '</div>';
        }).join('') + '</div>';
      }
      document.getElementById('sec-budgets').innerHTML =
        '<div class="sec-hdr"><h2>Presupuestos — ' + esc(monthFilter) + '</h2>' +
        '<button class="btn btn-primary btn-sm" data-action="open-bud">+ Nuevo presupuesto</button></div>' + html;
    });
}

/* ─── charts ───────────────────────────────────────────── */
function loadCharts() {
  api('/api/transactions/stats?month=' + monthFilter).then(function (d) {
    if (!d.ok) return;
    document.getElementById('sec-charts').innerHTML =
      '<div style="display:grid;gap:1rem">' +
        '<div class="chart-card"><div class="chart-title">Balance mensual — últimos 6 meses</div><div class="chart-wrap" style="height:260px"><canvas id="c-bar6" role="img" aria-label="Balance mensual"></canvas></div></div>' +
        '<div class="charts-grid">' +
          '<div class="chart-card"><div class="chart-title">Ingresos por categoría</div><div class="chart-wrap" style="height:240px"><canvas id="c-incc" role="img" aria-label="Ingresos por categoría"></canvas></div></div>' +
          '<div class="chart-card"><div class="chart-title">Gastos por categoría</div><div class="chart-wrap" style="height:240px"><canvas id="c-expc" role="img" aria-label="Gastos por categoría"></canvas></div></div>' +
        '</div>' +
      '</div>';
    buildBarFullChart(d.data.trend);
    buildCatCharts(d.data.byCategory);
  });
}

/* ─── account ──────────────────────────────────────────── */
function loadAccount() {
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
    var name  = esc(d.name  || '—');
    var email = esc(d.email || '—');
    document.getElementById('sec-account').innerHTML =
      // ── Información personal (editable) ──────────────────
      '<div class="account-block">' +
        '<h3>Información personal</h3>' +
        '<div id="profile-view">' +
          '<div class="a-row"><span class="a-lbl">Nombre</span><span id="disp-name">' + name + '</span></div>' +
          '<div class="a-row"><span class="a-lbl">Correo electrónico</span><span id="disp-email">' + email + '</span></div>' +
          '<div class="a-row"><span class="a-lbl">Rol</span><span>' + esc(d.role || 'usuario') + '</span></div>' +
          '<div style="margin-top:.6rem">' +
            '<button class="btn btn-ghost btn-sm" data-action="edit-profile">✏️ Editar nombre y correo</button>' +
          '</div>' +
        '</div>' +
        '<div id="profile-form" style="display:none;margin-top:.5rem">' +
          '<div class="form-group" style="margin-bottom:.6rem">' +
            '<label for="inp-name">Nombre</label>' +
            '<input type="text" id="inp-name" class="form-control" maxlength="100">' +
          '</div>' +
          '<div class="form-group" style="margin-bottom:.6rem">' +
            '<label for="inp-email">Correo electrónico</label>' +
            '<input type="email" id="inp-email" class="form-control" maxlength="255" autocomplete="email">' +
          '</div>' +
          '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
            '<button class="btn btn-primary btn-sm" data-action="save-profile">Guardar cambios</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="cancel-profile">Cancelar</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ── Cambiar contraseña ───────────────────────────────
      '<div class="account-block">' +
        '<h3>🔑 Contraseña</h3>' +
        '<div id="pwd-view">' +
          '<p style="color:var(--dim);font-size:.9rem;margin-bottom:.5rem">Por seguridad, te recomendamos cambiar tu contraseña cada cierto tiempo.</p>' +
          '<button class="btn btn-ghost btn-sm" data-action="show-pwd-form">Cambiar contraseña</button>' +
        '</div>' +
        '<div id="pwd-form" style="display:none;margin-top:.5rem">' +
          '<div class="form-group" style="margin-bottom:.6rem">' +
            '<label for="inp-cur-pwd">Contraseña actual</label>' +
            '<input type="password" id="inp-cur-pwd" class="form-control" autocomplete="current-password">' +
          '</div>' +
          '<div class="form-group" style="margin-bottom:.6rem">' +
            '<label for="inp-new-pwd">Nueva contraseña</label>' +
            '<input type="password" id="inp-new-pwd" class="form-control" autocomplete="new-password">' +
            '<p class="pwd-hint">Mín. 8 caracteres con mayúscula, minúscula, número y símbolo (@$!%*?&._-)</p>' +
          '</div>' +
          '<div class="form-group" style="margin-bottom:.6rem">' +
            '<label for="inp-conf-pwd">Confirmar nueva contraseña</label>' +
            '<input type="password" id="inp-conf-pwd" class="form-control" autocomplete="new-password">' +
          '</div>' +
          '<div id="totp-pwd-wrap" style="display:none;margin-bottom:.6rem">' +
            '<div class="form-group">' +
              '<label for="inp-totp-pwd">🔐 Código 2FA (requerido porque tienes 2FA activo)</label>' +
              '<input type="text" id="inp-totp-pwd" class="form-control" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" placeholder="123456" style="max-width:140px;letter-spacing:.2rem;text-align:center;font-size:1.05rem">' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
            '<button class="btn btn-primary btn-sm" data-action="save-password">Guardar contraseña</button>' +
            '<button class="btn btn-ghost btn-sm" data-action="cancel-pwd">Cancelar</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // ── 2FA ──────────────────────────────────────────────
      '<div class="account-block">' +
        '<h3>🔐 Seguridad — Verificación en dos pasos (2FA)</h3>' +
        '<div id="twofa-section"><p style="color:var(--dim)">Cargando...</p></div>' +
      '</div>' +

      // ── RGPD ─────────────────────────────────────────────
      '<div class="account-block">' +
        '<h3>Privacidad y datos (RGPD)</h3>' +
        '<div class="a-row"><span class="a-lbl">Exportar mis datos (art. 20)</span><a class="btn btn-ghost btn-sm" href="/api/auth/export" download="mis-datos.json">⬇ Descargar JSON</a></div>' +
        '<div class="a-row"><span class="a-lbl">Política de privacidad</span><a class="btn btn-ghost btn-sm" href="/privacidad" target="_blank">Ver</a></div>' +
        '<div class="a-row"><span class="a-lbl">Política de cookies</span><a class="btn btn-ghost btn-sm" href="/cookies" target="_blank">Ver</a></div>' +
        '<div class="a-row"><span class="a-lbl">Aviso legal</span><a class="btn btn-ghost btn-sm" href="/aviso-legal" target="_blank">Ver</a></div>' +
      '</div>' +

      // ── Zona de peligro ──────────────────────────────────
      '<div class="account-block danger-block">' +
        '<h3>Zona de peligro</h3>' +
        '<div class="a-row"><span class="a-lbl">Eliminar cuenta y todos mis datos (art. 17 RGPD)</span>' +
        '<button class="btn btn-danger btn-sm" data-action="del-account">Eliminar cuenta</button></div>' +
      '</div>';

    // Prerellenar inputs de perfil con los valores actuales
    var inpName  = document.getElementById('inp-name');
    var inpEmail = document.getElementById('inp-email');
    if (inpName)  inpName.value  = d.name  || '';
    if (inpEmail) inpEmail.value = d.email || '';

    load2FAStatus();
  });
}

/* ─── editar perfil ────────────────────────────────────── */
function showProfileForm() {
  document.getElementById('profile-view').style.display = 'none';
  document.getElementById('profile-form').style.display = 'block';
  document.getElementById('inp-name').focus();
}
function hideProfileForm() {
  document.getElementById('profile-view').style.display = 'block';
  document.getElementById('profile-form').style.display = 'none';
}
function saveProfile() {
  var name  = (document.getElementById('inp-name')?.value  || '').trim();
  var email = (document.getElementById('inp-email')?.value || '').trim();
  if (!name || name.length < 2) { toast('El nombre debe tener al menos 2 caracteres', 'err'); return; }
  if (!email || !/.+@.+\..+/.test(email)) { toast('Introduce un correo válido', 'err'); return; }

  api('/api/auth/profile', { method: 'PUT', body: JSON.stringify({ name: name, email: email }) })
    .then(function (d) {
      if (d.ok) {
        toast('✓ Perfil actualizado');
        loadAccount();           // refresca la vista con los datos nuevos
        var ui = document.getElementById('user-name');
        if (ui) ui.textContent = name;
      } else {
        toast(d.errors ? d.errors[0] : 'Error al actualizar', 'err');
      }
    })
    .catch(function () { toast('Error de conexión', 'err'); });
}

/* ─── cambiar contraseña ───────────────────────────────── */
function showPwdForm() {
  document.getElementById('pwd-view').style.display = 'none';
  document.getElementById('pwd-form').style.display = 'block';
  // Mostrar campo TOTP si el usuario tiene 2FA activo
  fetch('/api/auth/2fa/status', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      var wrap = document.getElementById('totp-pwd-wrap');
      if (wrap) wrap.style.display = s.enabled ? 'block' : 'none';
    });
  document.getElementById('inp-cur-pwd').focus();
}
function hidePwdForm() {
  document.getElementById('pwd-view').style.display = 'block';
  document.getElementById('pwd-form').style.display = 'none';
  // Limpiar campos
  ['inp-cur-pwd', 'inp-new-pwd', 'inp-conf-pwd', 'inp-totp-pwd'].forEach(function (id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
}
function savePassword() {
  var cur  = document.getElementById('inp-cur-pwd')?.value  || '';
  var pwd  = document.getElementById('inp-new-pwd')?.value  || '';
  var conf = document.getElementById('inp-conf-pwd')?.value || '';
  var totp = (document.getElementById('inp-totp-pwd')?.value || '').trim();

  if (!cur)  { toast('Introduce tu contraseña actual', 'err'); return; }
  if (!pwd)  { toast('Introduce la nueva contraseña', 'err'); return; }
  if (pwd !== conf) { toast('Las contraseñas no coinciden', 'err'); return; }
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._\-]).{8,128}$/.test(pwd)) {
    toast('La nueva contraseña no cumple los requisitos', 'err'); return;
  }

  var body = { currentPassword: cur, newPassword: pwd, confirmPassword: conf };
  // Solo enviar totpToken si el campo está visible (usuario tiene 2FA)
  var totpWrap = document.getElementById('totp-pwd-wrap');
  if (totpWrap && totpWrap.style.display !== 'none') {
    if (!/^\d{6}$/.test(totp)) { toast('Introduce el código 2FA de 6 dígitos', 'err'); return; }
    body.totpToken = totp;
  }

  api('/api/auth/password', { method: 'PUT', body: JSON.stringify(body) })
    .then(function (d) {
      if (d.ok) {
        toast('✓ Contraseña cambiada correctamente');
        hidePwdForm();
        // El servidor regeneró la sesión: refrescar el CSRF token
        fetch('/api/auth/me', { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (m) { csrfToken = m.csrfToken || csrfToken; });
      } else {
        toast(d.errors ? d.errors[0] : 'Error al cambiar la contraseña', 'err');
      }
    })
    .catch(function () { toast('Error de conexión', 'err'); });
}

/* ─── 2FA management ──────────────────────────────────── */
function load2FAStatus() {
  api('/api/auth/2fa/status').then(function (d) {
    var box = document.getElementById('twofa-section');
    if (!box) return;
    if (d.enabled) {
      box.innerHTML =
        '<div class="a-row"><span class="a-lbl">Estado</span><span style="color:#22c55e;font-weight:600">✓ Activado</span></div>' +
        '<p style="font-size:.85rem;color:var(--dim);margin:.5rem 0">Cada vez que inicies sesión te pediremos un código de 6 dígitos de tu aplicación autenticadora.</p>' +
        '<button class="btn btn-danger btn-sm" data-action="disable-2fa">Desactivar 2FA</button>';
    } else {
      box.innerHTML =
        '<div class="a-row"><span class="a-lbl">Estado</span><span style="color:var(--dim)">○ Desactivado</span></div>' +
        '<p style="font-size:.85rem;color:var(--dim);margin:.5rem 0">Añade una capa extra de seguridad a tu cuenta. Necesitarás una app como <strong>Google Authenticator</strong>, <strong>Authy</strong>, <strong>1Password</strong> o <strong>Microsoft Authenticator</strong>.</p>' +
        '<button class="btn btn-primary btn-sm" data-action="setup-2fa">Activar 2FA</button>';
    }
  });
}

function start2FASetup() {
  api('/api/auth/2fa/setup', { method: 'POST' }).then(function (d) {
    if (!d.ok) { toast(d.errors ? d.errors[0] : 'Error', 'err'); return; }
    var box = document.getElementById('twofa-section');
    box.innerHTML =
      '<p>1. Escanea este código QR con tu app autenticadora:</p>' +
      '<div style="text-align:center;margin:1rem 0;background:#fff;padding:1rem;border-radius:8px;display:inline-block">' +
        '<img src="' + d.qr + '" alt="QR 2FA" style="max-width:200px"></div>' +
      '<details style="margin:.5rem 0"><summary style="cursor:pointer;color:var(--dim);font-size:.85rem">¿No puedes escanear? Introduce manualmente</summary>' +
        '<p style="font-family:monospace;background:var(--bg-2);padding:.5rem;border-radius:4px;word-break:break-all;font-size:.85rem">' + esc(d.secret) + '</p>' +
      '</details>' +
      '<p style="margin-top:1rem">2. Introduce el código de 6 dígitos que muestra la app:</p>' +
      '<div style="display:flex;gap:.5rem;align-items:center;margin-top:.5rem">' +
        '<input type="text" id="totp-confirm" class="form-control" maxlength="6" inputmode="numeric" pattern="[0-9]{6}" placeholder="123456" style="max-width:120px;text-align:center;letter-spacing:.2rem;font-size:1.1rem">' +
        '<button class="btn btn-primary btn-sm" data-action="confirm-2fa">Confirmar</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="cancel-2fa">Cancelar</button>' +
      '</div>';
    setTimeout(function () { document.getElementById('totp-confirm')?.focus(); }, 100);
  });
}

function confirm2FAEnable() {
  var token = (document.getElementById('totp-confirm')?.value || '').trim();
  if (!/^\d{6}$/.test(token)) { toast('Introduce 6 dígitos', 'err'); return; }
  api('/api/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ token: token }) })
    .then(function (d) {
      if (d.ok) { toast('✓ 2FA activado correctamente'); load2FAStatus(); }
      else toast(d.errors ? d.errors[0] : 'Error al confirmar', 'err');
    });
}

function disable2FA() {
  var pwd = prompt('Por seguridad, introduce tu contraseña actual para desactivar 2FA:');
  if (!pwd) return;
  api('/api/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password: pwd }) })
    .then(function (d) {
      if (d.ok) { toast('2FA desactivado'); load2FAStatus(); }
      else toast(d.errors ? d.errors[0] : 'Contraseña incorrecta', 'err');
    });
}

/* ─── logout ───────────────────────────────────────────── */
function doLogout() {
  api('/api/auth/logout', { method: 'POST' })
    .then(function () { location.href = '/login'; })
    .catch(function () { location.href = '/login'; });
}

/* ─── tx modal ─────────────────────────────────────────── */
function openTxModal(id) {
  editId = id;
  document.getElementById('tx-err').classList.remove('show');
  document.getElementById('tx-modal-title').textContent = id ? 'Editar transacción' : 'Nueva transacción';
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-desc').value = '';
  document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10);
  setTxType('income');

  if (id) {
    api('/api/transactions').then(function (d) {
      var t = d.data && d.data.find(function (x) { return x.id === id; });
      if (!t) return;
      setTxType(t.type);
      document.getElementById('tx-amount').value = t.amount;
      document.getElementById('tx-desc').value   = t.description || '';
      document.getElementById('tx-date').value   = t.date;
      setTimeout(function () { document.getElementById('tx-cat').value = t.category; }, 20);
    });
  }

  document.getElementById('tx-overlay').classList.add('open');
  setTimeout(function () { document.getElementById('tx-amount').focus(); }, 60);
}

function closeTxModal() { document.getElementById('tx-overlay').classList.remove('open'); }

function setTxType(type) {
  txType = type;
  document.getElementById('btn-type-inc').className = 'type-btn' + (type === 'income' ? ' active-inc' : '');
  document.getElementById('btn-type-exp').className = 'type-btn' + (type === 'expense' ? ' active-exp' : '');
  var cats = type === 'income' ? CAT_INC : CAT_EXP;
  document.getElementById('tx-cat').innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
}

function saveTx() {
  var errEl  = document.getElementById('tx-err');
  var amount = parseFloat(document.getElementById('tx-amount').value);
  var cat    = document.getElementById('tx-cat').value;
  var desc   = document.getElementById('tx-desc').value.trim();
  var date   = document.getElementById('tx-date').value;

  if (!amount || amount <= 0 || !cat || !date) {
    errEl.textContent = 'Por favor rellena todos los campos obligatorios.';
    errEl.classList.add('show');
    return;
  }

  var btn = document.getElementById('tx-save');
  btn.disabled = true;

  var body   = JSON.stringify({ type: txType, amount: amount, category: cat, description: desc, date: date });
  var method = editId ? 'PUT'  : 'POST';
  var url    = editId ? '/api/transactions/' + editId : '/api/transactions';

  api(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: body })
    .then(function (d) {
      btn.disabled = false;
      if (d.ok) {
        closeTxModal();
        toast(editId ? 'Transacción actualizada' : 'Transacción añadida');
        editId = null;
        loadSection(currentSection());
      } else {
        errEl.textContent = d.errors ? d.errors.join(' · ') : 'Error al guardar.';
        errEl.classList.add('show');
      }
    })
    .catch(function () { btn.disabled = false; });
}

/* ─── budget modal ─────────────────────────────────────── */
function openBudModal() {
  document.getElementById('bud-cat').innerHTML = CAT_EXP.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  document.getElementById('bud-amount').value = '';
  document.getElementById('bud-month').value  = monthFilter;
  document.getElementById('bud-overlay').classList.add('open');
}
function closeBudModal() { document.getElementById('bud-overlay').classList.remove('open'); }

function saveBudget() {
  var cat    = document.getElementById('bud-cat').value;
  var amount = parseFloat(document.getElementById('bud-amount').value);
  var month  = document.getElementById('bud-month').value;
  if (!cat || !amount || amount <= 0 || !month) { toast('Rellena todos los campos del presupuesto', 'err'); return; }
  budgets = budgets.filter(function (b) { return !(b.category === cat && b.month === month); });
  budgets.push({ id: Date.now().toString(36), category: cat, amount: amount, month: month });
  localStorage.setItem('fa_budgets', JSON.stringify(budgets));
  closeBudModal();
  loadBudgets();
  toast('Presupuesto guardado');
}

/* ─── charts ───────────────────────────────────────────── */
function last6Months() {
  var r = [], n = new Date();
  for (var i = 5; i >= 0; i--) {
    var d = new Date(n.getFullYear(), n.getMonth() - i, 1);
    r.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return r;
}

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#7a7f94', font: { size: 11 } } },
      tooltip: { callbacks: { label: function (ctx) { return ' ' + fmt(ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed); } } }
    },
    scales: {
      x: { ticks: { color: '#7a7f94', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,.05)' } },
      y: { ticks: { color: '#7a7f94', font: { size: 11 }, callback: function (v) { return v + '€'; } }, grid: { color: 'rgba(255,255,255,.05)' } }
    }
  };
}

function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function buildTrendChart(trend) {
  var el = document.getElementById('c-trend'); if (!el) return;
  destroyChart('trend');
  var months = last6Months();
  charts['trend'] = new Chart(el, {
    type: 'line',
    data: {
      labels: months.map(fmtMonth),
      datasets: [
        { label: 'Ingresos', data: months.map(function (m) { return trend[m] ? trend[m].income : 0; }), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.1)', fill: true, tension: .4, pointRadius: 3 },
        { label: 'Gastos',   data: months.map(function (m) { return trend[m] ? trend[m].expense : 0; }), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.1)', fill: true, tension: .4, pointRadius: 3 }
      ]
    },
    options: chartDefaults()
  });
}

function buildDonutChart(byCategory) {
  var el = document.getElementById('c-donut'); if (!el) return;
  destroyChart('donut');
  var entries = Object.entries(byCategory).filter(function (e) { return e[1].expense > 0; });
  if (!entries.length) return;
  charts['donut'] = new Chart(el, {
    type: 'doughnut',
    data: { labels: entries.map(function (e) { return e[0]; }), datasets: [{ data: entries.map(function (e) { return e[1].expense; }), backgroundColor: COLORS, borderWidth: 0 }] },
    options: Object.assign({}, chartDefaults(), { cutout: '65%', scales: {} })
  });
}

function buildBarFullChart(trend) {
  var el = document.getElementById('c-bar6'); if (!el) return;
  destroyChart('bar6');
  var months = last6Months();
  charts['bar6'] = new Chart(el, {
    type: 'bar',
    data: {
      labels: months.map(fmtMonth),
      datasets: [
        { label: 'Ingresos', data: months.map(function (m) { return trend[m] ? trend[m].income : 0; }), backgroundColor: 'rgba(34,197,94,.7)', borderRadius: 4 },
        { label: 'Gastos',   data: months.map(function (m) { return trend[m] ? trend[m].expense : 0; }), backgroundColor: 'rgba(239,68,68,.7)', borderRadius: 4 }
      ]
    },
    options: chartDefaults()
  });
}

function buildCatCharts(byCategory) {
  var incEntries = Object.entries(byCategory).filter(function (e) { return e[1].income > 0; });
  var expEntries = Object.entries(byCategory).filter(function (e) { return e[1].expense > 0; });

  var eli = document.getElementById('c-incc');
  if (eli && incEntries.length) {
    destroyChart('incc');
    charts['incc'] = new Chart(eli, {
      type: 'bar',
      data: { labels: incEntries.map(function (e) { return e[0]; }), datasets: [{ label: '€', data: incEntries.map(function (e) { return e[1].income; }), backgroundColor: 'rgba(34,197,94,.7)', borderRadius: 4 }] },
      options: Object.assign({}, chartDefaults(), { indexAxis: 'y' })
    });
  }
  var ele = document.getElementById('c-expc');
  if (ele && expEntries.length) {
    destroyChart('expc');
    charts['expc'] = new Chart(ele, {
      type: 'bar',
      data: { labels: expEntries.map(function (e) { return e[0]; }), datasets: [{ label: '€', data: expEntries.map(function (e) { return e[1].expense; }), backgroundColor: 'rgba(239,68,68,.7)', borderRadius: 4 }] },
      options: Object.assign({}, chartDefaults(), { indexAxis: 'y' })
    });
  }
}

})();
