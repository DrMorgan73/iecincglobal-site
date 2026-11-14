/* Motion Arena — Ping Pong: phone controller.
   Joins the TV host by room code (PeerJS cloud by default), then streams
   paddle position at 15 Hz (per DESIGN.md). Control: touch-drag on the
   pad (always available) + optional tilt (deviceorientation, with the
   iOS permission ask on a user tap). Phones never report scores. */
(function () {
  'use strict';
  var S = window.PPShared;
  var $ = function (id) { return document.getElementById(id); };

  var chosenColor = S.COLORS[0].hex;
  var token = '';
  try { token = window.localStorage.getItem('pp-token') || ''; } catch (e) {}
  if (!token) {
    token = 'tok-' + Math.random().toString(36).slice(2, 10);
    try { window.localStorage.setItem('pp-token', token); } catch (e) {}
  }
  try {
    var savedName = window.localStorage.getItem('pp-name');
    if (savedName) $('nameInput').value = savedName;
    var savedColor = window.localStorage.getItem('pp-color');
    if (savedColor) chosenColor = savedColor;
  } catch (e) {}

  /* colour swatches */
  var sw = $('swatches');
  S.COLORS.forEach(function (c) {
    var b = document.createElement('button');
    b.className = 'swatch' + (c.hex === chosenColor ? ' sel' : '');
    b.style.background = c.hex;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.addEventListener('click', function () {
      chosenColor = c.hex;
      try { window.localStorage.setItem('pp-color', c.hex); } catch (e) {}
      var all = sw.querySelectorAll('.swatch');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('sel');
      b.classList.add('sel');
    });
    sw.appendChild(b);
  });

  /* saved room code (typing convenience) */
  try {
    var savedCode = window.localStorage.getItem('pp-code');
    if (savedCode) $('codeInput').value = savedCode;
  } catch (e) {}

  var peer = null, conn = null, side = -1, joined = false;
  var targetY = 0.5, tiltOn = false, tiltCenter = null, lastSent = -1;
  var connectDeadline = null;

  function show(id) {
    ['joinPanel', 'padPanel', 'errPanel'].forEach(function (p) {
      $(p).classList.toggle('hidden', p !== id);
    });
  }
  function fail(msg) {
    clearTimeout(connectDeadline);
    $('errMsg').textContent = msg;
    show('errPanel');
  }
  function joinMsg(txt, isErr) {
    var m = $('joinMsg');
    m.textContent = txt;
    m.className = 'msg' + (isErr ? ' err' : '');
  }

  function join() {
    var code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { joinMsg('Enter the 4-letter room code from the TV.', true); return; }
    var name = $('nameInput').value.trim() || 'Player';
    try {
      window.localStorage.setItem('pp-name', name);
      window.localStorage.setItem('pp-code', code);
    } catch (e) {}
    joinMsg('Connecting…');
    if (typeof window.Peer === 'undefined') {
      fail('The controller library could not load, so phone play is unavailable. You can still play on the TV screen.');
      return;
    }
    teardown();
    var myPeer;
    try {
      myPeer = new window.Peer(undefined, S.brokerOptions());
    } catch (e) {
      fail('Could not start the connection. Phone play needs internet — check Wi-Fi or mobile data, then try again.');
      return;
    }
    peer = myPeer;
    connectDeadline = setTimeout(function () {
      if (!joined) {
        fail('Could not reach the room in time. Phone play needs an internet connection (the phone and TV meet through the PeerJS cloud). Check your connection and the room code, then try again.');
        teardown();
      }
    }, 12000);
    myPeer.on('open', function () {
      var c = myPeer.connect(S.peerIdFor(code), { reliable: true });
      conn = c;
      c.on('open', function () {
        c.send({ t: 'join', name: name, color: chosenColor, token: token });
      });
      c.on('data', onHostData);
      c.on('close', function () {
        if (joined) { joined = false; fail('The connection to the TV was lost. Rejoin with the same room code to reclaim your side.'); }
      });
      c.on('error', function () { /* surfaced via timeout / close */ });
    });
    myPeer.on('error', function (err) {
      var type = err && err.type ? err.type : '';
      if (joined) return;
      if (type === 'peer-unavailable') {
        fail('Room "' + code + '" was not found. Check the code on the TV — the TV must be on the Ping Pong lobby screen.');
      } else {
        fail('Connection problem (' + (type || 'unknown') + '). Phone play needs internet — check Wi-Fi or mobile data, then try again.');
      }
      teardown();
    });
  }
  function teardown() {
    clearTimeout(connectDeadline);
    try { if (conn) conn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    conn = null; peer = null; side = -1;
  }

  function onHostData(data) {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'welcome') {
      joined = true;
      side = data.side;
      clearTimeout(connectDeadline);
      $('padPaddle').style.background = chosenColor;
      $('padStatus').textContent = 'You are the ' + (side === 0 ? 'LEFT' : 'RIGHT') + ' paddle. Drag on the pad, or enable tilt.';
      show('padPanel');
      requestWake();
    } else if (data.t === 'full') {
      joined = true;
      clearTimeout(connectDeadline);
      fail('That room already has two players. You can watch on the TV, or start a game on the TV screen.');
    } else if (data.t === 'state') {
      $('sbLeft').textContent = data.names[0] || '—';
      $('sbRight').textContent = data.names[1] || '—';
      $('sbScore').textContent = data.scores[0] + ' : ' + data.scores[1];
      var serve = $('serveBtn');
      if (data.yourServe) serve.classList.remove('hidden'); else serve.classList.add('hidden');
      if (data.phase === 'serve') tiltCenter = null; // recalibrate tilt each serve
    }
  }

  /* 15 Hz paddle stream (DESIGN.md motion pipeline) */
  setInterval(function () {
    if (!joined || !conn || !conn.open || side < 0) return;
    if (Math.abs(targetY - lastSent) < 0.0015 && lastSent >= 0) return;
    lastSent = targetY;
    try { conn.send({ t: 'pad', y: Math.round(targetY * 1000) / 1000 }); } catch (e) {}
  }, 66);

  /* touch / mouse drag on the pad */
  var pad = $('pad'), padPaddle = $('padPaddle');
  function padMove(clientY) {
    var r = pad.getBoundingClientRect();
    targetY = S.clamp((clientY - r.top) / r.height, 0, 1);
    padPaddle.style.top = (targetY * 100) + '%';
    tiltOn = tiltOn; // touch and tilt share one target; last writer wins
  }
  pad.addEventListener('touchstart', function (e) { e.preventDefault(); padMove(e.touches[0].clientY); }, { passive: false });
  pad.addEventListener('touchmove', function (e) { e.preventDefault(); padMove(e.touches[0].clientY); }, { passive: false });
  pad.addEventListener('mousemove', function (e) { if (e.buttons) padMove(e.clientY); });
  pad.addEventListener('mousedown', function (e) { padMove(e.clientY); });

  /* tilt control: deviceorientation beta, centred per serve */
  function onTilt(e) {
    if (!tiltOn || e.beta === null || e.beta === undefined) return;
    if (tiltCenter === null) tiltCenter = e.beta;
    var d = (e.beta - tiltCenter); // tipping the top of the phone away raises beta
    targetY = S.clamp(0.5 + d / 55, 0, 1);
    padPaddle.style.top = (targetY * 100) + '%';
  }
  $('btnTilt').addEventListener('click', function () {
    function enable() {
      tiltOn = true;
      tiltCenter = null;
      window.addEventListener('deviceorientation', onTilt);
      $('btnTilt').textContent = 'Tilt control ON';
      $('padStatus').textContent = 'Tilt is on: tip the phone toward or away from you to move. Touch still works too.';
    }
    if (typeof window.DeviceOrientationEvent !== 'undefined' &&
        typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      window.DeviceOrientationEvent.requestPermission().then(function (res) {
        if (res === 'granted') enable();
        else $('padStatus').textContent = 'Motion permission was not granted — touch drag still works.';
      }).catch(function () {
        $('padStatus').textContent = 'Motion is unavailable on this phone — touch drag still works.';
      });
    } else if ('DeviceOrientationEvent' in window) {
      enable();
    } else {
      $('padStatus').textContent = 'This phone has no tilt sensor available — touch drag still works.';
    }
  });

  $('serveBtn').addEventListener('click', function () {
    if (conn && conn.open) { try { conn.send({ t: 'serve' }); } catch (e) {} }
  });
  $('btnJoin').addEventListener('click', join);
  $('btnRetry').addEventListener('click', function () { show('joinPanel'); });
  $('btnLeave').addEventListener('click', function () {
    teardown();
    joined = false;
    show('joinPanel');
    joinMsg('');
  });
  $('codeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') join(); });

  function requestWake() {
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request('screen').catch(function () {});
      }
    } catch (e) {}
  }

  /* debug / test hooks (used by check-pingpong.py) */
  window.PPC = {
    version: '1.0.0',
    getState: function () {
      return { joined: joined, side: side, targetY: targetY, tiltOn: tiltOn,
               panel: $('padPanel').classList.contains('hidden') ? 'not-pad' : 'pad' };
    },
    join: join,
    setTarget: function (y) { targetY = S.clamp(y, 0, 1); },
    /* test hooks: peerId proves the signaling path; injectData runs a
       host message through the real onHostData handler */
    peerId: function () { return peer ? peer.id : null; },
    injectData: function (msg) { onHostData(msg); }
  };
})();
