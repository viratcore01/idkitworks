// ── Zoclo boot sentry (external, so extensions can't strip it) ──────────
// Three failure modes, three answers:
//   1. App never starts (old browser, JS partially blocked, bad chunk) → card.
//   2. A deploy lands mid-session and a lazy chunk 404s → ONE clean reload
//      re-syncs to the new build (wizard progress survives — sessionStorage).
//      Guarded so it can never loop.
//   3. React crashes AFTER mount (it unmounts the whole tree) → card with
//      the captured errors.
(function () {
  var errors = [];
  function push(msg) { errors.push(msg); if (errors.length > 8) errors.shift(); }
  window.addEventListener('error', function (e) {
    push((e.message || 'Script error') + (e.filename ? ' @ ' + e.filename.split('/').pop() : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var m = r && r.message ? r.message : String(r);
    push('Promise: ' + m);
    if (/import|chunk|module script|dynamically/i.test(m) && !sessionStorage.getItem('boot:autoreload')) {
      sessionStorage.setItem('boot:autoreload', '1');
      location.reload();
    }
  });
  function detail() {
    return errors.length
      ? '<pre style="text-align:left;background:#fff;border:2px solid #0F172A;padding:10px;overflow:auto;font-size:12px;max-height:180px">' + errors.slice(0, 5).map(function (s) { return s.replace(/</g, '&lt;'); }).join('\n') + '</pre>'
      : '<p style="font-size:13px">No error was captured.</p>';
  }
  function card(why) {
    if (document.getElementById('boot-card')) return;
    var box = document.createElement('div');
    box.id = 'boot-card';
    box.setAttribute('style', 'position:fixed;inset:0;background:#FAF7F2;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;color:#0F172A');
    box.innerHTML = '<div style="max-width:420px;border:3px solid #0F172A;box-shadow:6px 6px 0 #0F172A;background:#fff;padding:24px">'
      + '<h1 style="font-size:18px;margin:0 0 8px">Zoclo hit a snag</h1>'
      + '<p style="font-size:13px;margin:0 0 12px">' + why + ' A refresh usually fixes it — your progress is kept.</p>'
      + detail()
      + '</div>';
    document.body.appendChild(box);
  }
  // 1 + 2: did the app ever mount?
  var checks = 0;
  var boot = setInterval(function () {
    var root = document.getElementById('root');
    if (root && root.childElementCount > 0) {
      clearInterval(boot);
      sessionStorage.removeItem('boot:autoreload');
      return;
    }
    if (++checks < 6) return;
    clearInterval(boot);
    card('The app never started — JavaScript may be blocked for this site, or the browser is outdated.');
  }, 1000);
  // 3: mounted, then the tree vanished (fatal runtime error).
  var wasMounted = false;
  var empty = 0;
  setInterval(function () {
    var root = document.getElementById('root');
    if (!root) return;
    if (root.childElementCount > 0) { wasMounted = true; empty = 0; return; }
    if (!wasMounted) return;
    if (++empty === 2) card('The app crashed while running.');
  }, 1000);
})();
