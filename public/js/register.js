(function () {
  var pwdColors = ['','#ef4444','#f59e0b','#eab308','#22c55e','#22c55e'];
  document.getElementById('password').addEventListener('input', function () {
    var v = this.value, s = 0;
    if (v.length >= 8) s++;
    if (/[A-Z]/.test(v)) s++;
    if (/[a-z]/.test(v)) s++;
    if (/\d/.test(v)) s++;
    if (/[@$!%*?&._\-]/.test(v)) s++;
    var bar = document.getElementById('pwd-bar');
    bar.style.width = (s * 20) + '%';
    bar.style.background = pwdColors[s] || 'var(--bg3)';
  });

  function showErr(msg) {
    var el = document.getElementById('err-box');
    el.textContent = msg;
    el.classList.add('show');
  }

  document.getElementById('btn-register').addEventListener('click', function () {
    document.getElementById('err-box').classList.remove('show');

    var name    = document.getElementById('name').value.trim();
    var email   = document.getElementById('email').value.trim();
    var pass    = document.getElementById('password').value;
    var confirm = document.getElementById('confirm').value;
    var privacy = document.getElementById('chk-privacy').checked;
    var cookies = document.getElementById('chk-cookies').checked;

    if (!name || !email || !pass || !confirm) { showErr('Por favor completa todos los campos.'); return; }
    if (!privacy || !cookies) { showErr('Debes aceptar los consentimientos obligatorios.'); return; }
    if (pass !== confirm) { showErr('Las contraseñas no coinciden.'); return; }
    if (pass.length < 8) { showErr('La contraseña debe tener al menos 8 caracteres.'); return; }

    var btn = document.getElementById('btn-register');
    btn.disabled = true;
    btn.textContent = 'Creando cuenta...';

    fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ name: name, email: email, password: pass, confirmPassword: confirm, privacyConsent: privacy, cookieConsent: cookies })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        window.location.href = data.redirect;
      } else {
        showErr(data.errors ? data.errors.join(' · ') : 'Error al registrarse.');
        btn.disabled = false;
        btn.textContent = 'Crear mi cuenta';
      }
    })
    .catch(function () {
      showErr('Error de conexión.');
      btn.disabled = false;
      btn.textContent = 'Crear mi cuenta';
    });
  });
})();