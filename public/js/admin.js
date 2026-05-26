(function () {
  var csrfToken = null;

  function showErr(msg) {
    var el = document.getElementById('err-box');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function api(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    if (opts.method && opts.method !== 'GET') {
      opts.headers = opts.headers || {};
      opts.headers['X-CSRF-Token'] = csrfToken || '';
    }
    return fetch(url, opts).then(function (r) {
      if (r.status === 401) { location.href = '/login?expired=1'; throw new Error('unauth'); }
      if (r.status === 403) { location.href = '/login'; throw new Error('forbidden'); }
      return r.json();
    });
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function loadUsers() {
    api('/api/admin/users').then(function (d) {
      if (!d.ok) { showErr('Error al cargar usuarios.'); return; }
      document.getElementById('user-count').textContent = d.data.length + ' usuario(s)';
      var rows = d.data.map(function (u) {
        return '<tr>' +
          '<td>' + esc(u.name) + '</td>' +
          '<td>' + esc(u.email) + '</td>' +
          '<td><span class="badge badge-' + (u.role === 'admin' ? 'inc' : 'exp') + '">' + esc(u.role) + '</span></td>' +
          '<td><span style="color:' + (u.active ? 'var(--green)' : 'var(--red)') + '">' + (u.active ? 'Activo' : 'Inactivo') + '</span></td>' +
          '<td>' + (u.lastLogin ? new Date(u.lastLogin).toLocaleString('es-ES') : '—') + '</td>' +
          '<td><button class="btn btn-ghost btn-sm" data-id="' + esc(u.id) + '" data-action="toggle">' + (u.active ? 'Desactivar' : 'Activar') + '</button></td>' +
        '</tr>';
      }).join('');
      document.getElementById('users-body').innerHTML =
        '<table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acción</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table>';
    }).catch(function () { showErr('Sin acceso o sesión expirada.'); });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action="toggle"]');
    if (!btn) {
      if (e.target.id === 'btn-logout') doLogout();
      return;
    }
    var id = btn.dataset.id;
    if (!confirm('¿Cambiar estado de este usuario?')) return;
    api('/api/admin/users/' + id + '/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' } })
      .then(function (d) {
        if (d.ok) loadUsers();
        else showErr('Error al cambiar estado.');
      });
  });

  function doLogout() {
    api('/api/auth/logout', { method: 'POST' })
      .then(function () { location.href = '/login'; })
      .catch(function () { location.href = '/login'; });
  }

  /* Verificar sesión admin y cargar CSRF token */
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok || !d.auth || d.role !== 'admin') { location.href = '/login'; return; }
      csrfToken = d.csrfToken || null;
      loadUsers();
    })
    .catch(function () { location.href = '/login'; });
})();
