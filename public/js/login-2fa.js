(function () {
  var input = document.getElementById('token');
  var btn   = document.getElementById('btn-verify');

  function showErr(msg) {
    var el = document.getElementById('err-box');
    el.textContent = msg;
    el.classList.add('show');
  }
  function hideErr() { document.getElementById('err-box').classList.remove('show'); }

  // Solo dígitos
  input.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 6);
    // Auto-submit cuando hay 6 dígitos
    if (this.value.length === 6) verify();
  });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') verify(); });
  btn.addEventListener('click', verify);

  function verify() {
    hideErr();
    var token = input.value.trim();
    if (!/^\d{6}$/.test(token)) { showErr('Introduce un código de 6 dígitos.'); return; }

    btn.disabled = true;
    btn.textContent = 'Verificando...';

    fetch('/api/auth/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token: token }),
    })
    .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
    .then(function (res) {
      if (res.data.ok) {
        window.location.href = res.data.redirect || '/dashboard';
      } else {
        showErr(res.data.errors ? res.data.errors[0] : 'Código incorrecto.');
        btn.disabled = false;
        btn.textContent = 'Verificar y entrar';
        input.value = '';
        input.focus();
      }
    })
    .catch(function () {
      showErr('Error de conexión. Inténtalo de nuevo.');
      btn.disabled = false;
      btn.textContent = 'Verificar y entrar';
    });
  }
})();
