/* Motion Arena — Ping Pong: shared constants + wire protocol.
   Used by host.js (TV) and controller.js (phone). Classic script, no
   modules, so the game also runs from file:// (USB stick, offline). */
(function (global) {
  'use strict';

  var PP = {};

  /* Canvas / court geometry (internal resolution, per DESIGN.md). */
  PP.W = 1920;
  PP.H = 1080;
  PP.COURT = { x: 110, y: 140, w: 1700, h: 800 };   // table surface
  PP.PADDLE_W = 26;
  PP.PADDLE_H = 170;
  PP.PADDLE_X = [146, 1920 - 146 - 26];             // left, right paddle x
  PP.BALL_R = 14;

  /* Rules: first to 11, win by 2 (table-tennis scoring). */
  PP.WIN_SCORE = 11;
  PP.WIN_LEAD = 2;

  /* PeerJS: room peer id = prefix + 4-char code. Default broker is the
     PeerJS cloud (per DESIGN.md). A different broker can be selected with
     URL params (?broker=local or ?brokerHost=..&brokerPort=..&brokerPath=..),
     which the automated checks use with the repo's local PeerServer. */
  PP.PEER_PREFIX = 'ma-pp-';
  PP.CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  PP.makeRoomCode = function () {
    var s = '';
    for (var i = 0; i < 4; i++) {
      s += PP.CODE_ALPHABET[Math.floor(Math.random() * PP.CODE_ALPHABET.length)];
    }
    return s;
  };

  PP.peerIdFor = function (code) {
    return PP.PEER_PREFIX + String(code).toUpperCase();
  };

  /* Query params, with an ES5 fallback: URLSearchParams needs Chrome 49+;
     older TV browsers fall back to a manual parse of location.search. */
  function queryParams() {
    if (typeof global.URLSearchParams === 'function') return new global.URLSearchParams(global.location.search);
    var map = {};
    var s = String(global.location.search || '').replace(/^\?/, '');
    var parts = s.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      var kv = parts[i].split('=');
      try { map[decodeURIComponent(kv[0])] = kv.length > 1 ? decodeURIComponent(kv.slice(1).join('=')) : ''; } catch (e) {}
    }
    return { get: function (k) { return k in map ? map[k] : null; } };
  }

  PP.brokerOptions = function () {
    var q = queryParams();
    if (q.get('broker') === 'local') {
      return { host: global.location.hostname || 'localhost', port: 9000, path: '/', secure: false, debug: 0 };
    }
    if (q.get('brokerHost')) {
      return {
        host: q.get('brokerHost'),
        port: parseInt(q.get('brokerPort') || '443', 10),
        path: q.get('brokerPath') || '/',
        secure: q.get('brokerSecure') !== '0',
        key: q.get('brokerKey') || 'peerjs',
        debug: 0
      };
    }
    return { debug: 0 }; // PeerJS cloud defaults
  };

  /* Player colours (preview palette from DESIGN.md + IEC gold). */
  PP.COLORS = [
    { id: 'gold',   hex: '#C9A227', name: 'Gold' },
    { id: 'red',    hex: '#e74c3c', name: 'Red' },
    { id: 'blue',   hex: '#3498db', name: 'Blue' },
    { id: 'green',  hex: '#2ecc71', name: 'Green' },
    { id: 'orange', hex: '#e67e22', name: 'Orange' }
  ];

  PP.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  PP.lerp = function (a, b, t) { return a + (b - a) * t; };

  global.PPShared = PP;
})(window);
