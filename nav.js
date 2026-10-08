/* IEC public site — nav behavior: smooth mobile menu, shrink-on-scroll header, back-to-top */
(function () {
  var btn = document.querySelector('.menu-btn');
  var nav = document.querySelector('.site-nav');
  var header = document.querySelector('.site-header');

  function closeMenu() {
    if (!nav || !btn) return;
    nav.classList.remove('open');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open menu');
  }

  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeMenu);
    });
  }

  var ticking = false;
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle('scrolled', y > 24);
    var top = document.getElementById('toTop');
    if (top) top.classList.toggle('show', y > 600);
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { window.requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });
  onScroll();

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('#toTop') : null;
    if (t) window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
