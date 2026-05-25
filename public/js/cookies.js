/* Cookie banner — LSSI-CE art. 22.2 */
(function () {
  function checkBanner() {
    var banner = document.getElementById('cookie-banner');
    if (!banner) return;
    banner.style.display = localStorage.getItem('cookie_consent') ? 'none' : 'flex';
  }
  window.acceptCookies = function (all) {
    localStorage.setItem('cookie_consent', all ? 'all' : 'essential');
    var banner = document.getElementById('cookie-banner');
    if (banner) banner.style.display = 'none';
  };
  function initCookies() {
    checkBanner();
    var btnAll = document.getElementById('btn-accept-all');
    if (btnAll) {
      btnAll.addEventListener('click', function() { window.acceptCookies(true); });
    }
    var btnEssential = document.getElementById('btn-accept-essential');
    if (btnEssential) {
      btnEssential.addEventListener('click', function() { window.acceptCookies(false); });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCookies);
  } else {
    initCookies();
  }
})();
