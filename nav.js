/* IEC public site — mobile menu toggle */
(function () {
  var btn = document.querySelector('.menu-btn');
  var nav = document.querySelector('.site-nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { nav.classList.remove('open'); });
  });
})();

/* IEC public site — "Strategic partnerships" dropdown (touch support) */
(function () {
  document.querySelectorAll('.nav-drop').forEach(function (drop) {
    var btn = drop.querySelector('.nav-drop-btn');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = drop.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.nav-drop.open').forEach(function (drop) {
      drop.classList.remove('open');
      var btn = drop.querySelector('.nav-drop-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.nav-drop.open').forEach(function (drop) { drop.classList.remove('open'); });
    }
  });
})();
