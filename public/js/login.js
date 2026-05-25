(function () {
  var params = new URLSearchParams(location.search);
  if (params.get('expired')) showErr('Tu sesión ha expirado. Inicia sesión de nuevo.');

  function showErr(msg) {
    var el = document.getElementById('err-box');
    el.textContent = msg;
    el.classList.add('show');
  }
  function hideErr() { document.getElementById('err-box').classList.remove('show'); }

  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  document.getElementById('email').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

  function doLogin() {
    hideErr();
    var email    = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;
    if (!email || !password) { showErr('Por favor completa todos los campos.'); return; }

    var btn = document.getElementById('btn-login');
    btn.disabled = true;
    btn.textContent = 'Verificando...';

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: email, password: password })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        window.location.href = data.redirect;
      } else {
        showErr(data.errors ? data.errors[0] : 'Error al iniciar sesión.');
        btn.disabled = false;
        btn.textContent = 'Iniciar sesión';
      }
    })
    .catch(function () {
      showErr('Error de conexión. Inténtalo de nuevo.');
      btn.disabled = false;
      btn.textContent = 'Iniciar sesión';
    });
  }
})();