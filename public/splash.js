/* Pingo load splash: the ball hops across the letters, each letter pops up as it
   lands, the paddle swings in to meet it, the swooshes sweep in and the subtitle
   appears. About 2 seconds on every page load, skippable by tap, click or
   any key, and a short fade only when the system asks for reduced motion.
   Layer positions are logo pixels (640 x 428); see scripts/splash-layers.py. */
(function () {
  var splash = document.getElementById('splash');
  if (!splash) return;
  if (typeof splash.animate !== 'function') { splash.remove(); return; }

  var logo = splash.querySelector('.splash-logo');
  var $ = function (sel) { return splash.querySelector(sel); };
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var done = false;
  var timer = 0;

  function finish(fast) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey, true);
    var out = splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 180 : 350, easing: 'ease-in', fill: 'forwards' });
    if (!reduce && !fast) logo.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }], { duration: 350, easing: 'ease-in', fill: 'forwards' });
    out.onfinish = function () { splash.remove(); };
  }
  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(true); }
  }
  splash.addEventListener('click', function () { finish(true); });
  document.addEventListener('keydown', onKey, true);

  function start() {
    if (done) return;
    splash.classList.remove('splash-wait');
    if (reduce) { timer = setTimeout(finish, 1200); return; }

    var both = function (delay, duration, easing) {
      return { delay: delay, duration: duration, easing: easing || 'ease-out', fill: 'both' };
    };

    // Ball: hops landing on top of P, i, n, g, o, then rises onto the paddle.
    var k = logo.getBoundingClientRect().width / 640;
    var END = [565, 108];
    var stops = [[-40, 40, 0], [110, 169, 300], [223, 156, 450], [290, 199, 600], [432, 194, 750], [566, 189, 900], [565, 108, 1150]];
    var TOTAL = 1150;
    var frames = [];
    var at = function (x, y, t, squash) {
      var s = squash ? ' scale(1.22, 0.8)' : '';
      frames.push({ offset: t / TOTAL, transform: 'translate(' + ((x - END[0]) * k).toFixed(1) + 'px,' + ((y - END[1]) * k).toFixed(1) + 'px)' + s });
    };
    at(stops[0][0], stops[0][1], 0, false);
    for (var h = 1; h < stops.length; h++) {
      var a = stops[h - 1], b = stops[h], last = h === stops.length - 1;
      var apex = last ? b[1] - 22 : Math.min(a[1], b[1]) - (h === 1 ? 70 : 52);
      var c = 2 * apex - (a[1] + b[1]) / 2;
      for (var i = 1; i <= 8; i++) {
        var u = i / 8;
        var x = a[0] + (b[0] - a[0]) * u;
        var y = (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * c + u * u * b[1];
        if (last) y = a[1] + (b[1] - a[1]) * (1 - Math.pow(1 - u, 2)) - Math.sin(u * Math.PI) * 14;
        at(x, y, a[2] + (b[2] - a[2]) * u, i === 8 && !last);
      }
    }
    $('.splash-ball').animate(frames, both(0, TOTAL, 'linear'));
    $('.splash-ball').animate([{ opacity: 0 }, { opacity: 1 }], both(0, 120));

    // Letters pop up as the ball lands on them.
    ['p', 'i', 'n', 'g', 'o'].forEach(function (name, n) {
      var el = $('.sp-' + name);
      el.style.transformOrigin = '50% 100%';
      el.animate([
        { opacity: 0, transform: 'translateY(26%) scale(0.35)' },
        { opacity: 1, transform: 'translateY(-7%) scale(1.12)', offset: 0.55 },
        { opacity: 1, transform: 'none' },
      ], both(stops[n + 1][2] - 50, 360));
    });

    // Paddle swings up from its handle to meet the ball, with a small hit ring.
    var paddle = $('.sp-paddle');
    paddle.style.transformOrigin = '2% 98%';
    paddle.animate([
      { opacity: 0, transform: 'rotate(60deg)' },
      { opacity: 1, offset: 0.35 },
      { transform: 'rotate(-7deg)', offset: 0.78 },
      { opacity: 1, transform: 'none' },
    ], both(760, 440, 'cubic-bezier(.3,.6,.35,1)'));
    $('.splash-ring').animate([
      { opacity: 0.9, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(2.6)' },
    ], { delay: 1140, duration: 480, easing: 'ease-out' }); // CSS keeps it hidden before and after

    // Swooshes sweep in, then the subtitle rises.
    $('.sp-swoosh-red').animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], both(980, 420, 'cubic-bezier(.4,0,.2,1)'));
    $('.sp-swoosh-blue').animate([{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0)' }], both(1060, 440, 'cubic-bezier(.4,0,.2,1)'));
    $('.splash-sub').animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], both(1150, 380));
    $('.splash-skip').animate([{ opacity: 0 }, { opacity: 1 }], both(300, 300));

    timer = setTimeout(finish, 2000);
  }

  // Wait (briefly) for the layers so the animation never plays with gaps.
  var imgs = Array.prototype.slice.call(splash.querySelectorAll('img'));
  var ready = Promise.all(imgs.map(function (img) {
    return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
  }));
  Promise.race([ready, new Promise(function (r) { setTimeout(r, 1200); })]).then(start);
})();
