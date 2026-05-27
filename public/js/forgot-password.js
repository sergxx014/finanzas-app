(function () {
  function showErr(msg) { show('err-box', msg); }
  function showOk(msg)  { show('ok-box',  msg); }
  function show(id, msg) {
    var el = document.getElementById(id);
    el.textContent = msg;
    el.classList.add('show');
  }
  function hideAll() {
    document.getElementById('err-box').classList.remove('show');
    document.getElementById('ok-box').classList.remove('show');
  }

  document.getElementById('btn-send').addEventListener('click', doSend);
  document.getElementById('email').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSend(); });

  function doSend() {
    hideAll();
    var email = document.getElementById('email').value.trim();
    if (!email) { showErr('Introduce tu correo electrónico.'); return; }

    var btn = document.getElementById('btn-send');
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: email }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) {
        showOk(data.msg);
        document.getElementById('email').value = '';
      } else {
        showErr(data.errors ? data.errors[0] : 'Error al enviar.');
      }
      btn.disabled = false;
      btn.textContent = 'Enviar enlace';
    })
    .catch(function () {
      showErr('Error de conexión. Inténtalo de nuevo.');
      btn.disabled = false;
      btn.textContent = 'Enviar enlace';
    });
  }
})();
