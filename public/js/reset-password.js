(function () {
  var token = new URLSearchParams(location.search).get('token');

  function showErr(msg) { show('err-box', msg); }
  function showOk(msg)  { show('ok-box',  msg); }
  function show(id, msg) {
    var el = document.getElementById(id);
    el.textContent = msg;
    el.classList.add('show');
  }

  if (!token) {
    showErr('Enlace inválido. Solicita uno nuevo desde la pantalla de login.');
    document.getElementById('form-wrap').style.display = 'none';
  }

  document.getElementById('btn-reset').addEventListener('click', doReset);
  document.getElementById('confirm').addEventListener('keydown', function (e) { if (e.key === 'Enter') doReset(); });

  function doReset() {
    document.getElementById('err-box').classList.remove('show');
    var pwd     = document.getElementById('password').value;
    var confirm = document.getElementById('confirm').value;
    if (!pwd || !confirm) { showErr('Completa los dos campos.'); return; }
    if (pwd !== confirm)  { showErr('Las contraseñas no coinciden.'); return; }

    var btn = document.getElementById('btn-reset');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: token, newPassword: pwd, confirmPassword: confirm }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        showOk('Contraseña actualizada. Redirigiendo...');
        document.getElementById('form-wrap').style.display = 'none';
        setTimeout(function () { window.location.href = '/login'; }, 2000);
      } else {
        showErr(data.errors ? data.errors[0] : 'Error al guardar.');
        btn.disabled = false;
        btn.textContent = 'Guardar nueva contraseña';
      }
    })
    .catch(function () {
      showErr('Error de conexión. Inténtalo de nuevo.');
      btn.disabled = false;
      btn.textContent = 'Guardar nueva contraseña';
    });
  }
})();
