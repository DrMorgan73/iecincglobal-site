/* Motion Arena — Ping Pong: TV host.
   Owns all game state and scoring (per DESIGN.md). Canvas 1920x1080.
   Modes: 'ai' (1P vs computer, host keyboard/mouse/touch), 'local'
   (2P same screen), 'phone' (PeerJS phone controllers, local fallback).
   Sound-free by design. Runs from https, localhost, or file:// (USB). */
(function () {
  'use strict';
  var S = window.PPShared;
  var W = S.W, H = S.H, COURT = S.COURT;
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  /* ---------------- state ---------------- */
  var phase = 'lobby';           // lobby | serve | rally | point | over
  var mode = 'ai';               // ai | local | phone
  var scores = [0, 0];
  var server = 0;
  var pointTimer = 0, serveTimer = 0;
  var lastScorer = -1, pointFlash = 0;
  var rallyHits = 0, bestRally = 0;
  var winner = -1;
  var names = ['You', 'Computer'];
  var colors = [S.COLORS[0].hex, S.COLORS[1].hex];
  var gamesWon = [0, 0];

  var ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: 0 };
  var trail = [];
  var particles = [];
  var paddles = [
    { y: H / 2, target: H / 2 },
    { y: H / 2, target: H / 2 }
  ];
  var keys = {};
  var aiError = [0, 0];

  var BASE_SPEED = 660, MAX_SPEED = 1560, SPEED_UP = 1.05;
  var HUMAN_SPEED = 1120;        // keyboard paddle speed px/s
  var AI_SPEED = 605;            // computer paddle max speed px/s

  function courtTop() { return COURT.y; }
  function courtBottom() { return COURT.y + COURT.h; }
  function clampPaddleY(y) {
    return S.clamp(y, courtTop() + S.PADDLE_H / 2, courtBottom() - S.PADDLE_H / 2);
  }
  function y01ToPx(v) { return courtTop() + S.clamp(v, 0, 1) * COURT.h; }
  function pxToY01(y) { return (y - courtTop()) / COURT.h; }

  /* ---------------- quality manager ----------------
     Full effects at level 2; slow frames step down: 1 (no ball trail,
     fewer particles, no soft shadows), 0 (flat fills). Never steps up
     mid-match, so a modest TV GPU can only make it smoother. */
  var quality = 2, frameAvg = 16.7, slowFrames = 0;
  function noteFrame(dtMs) {
    frameAvg = frameAvg * 0.92 + dtMs * 0.08;
    if (frameAvg > 20 && quality > 0) {
      if (++slowFrames > 45) { quality--; slowFrames = 0; frameAvg = 16.7; staticLayer = null; }
    } else if (slowFrames > 0) slowFrames--;
  }

  /* ---------------- flow ---------------- */
  function setServe() {
    phase = 'serve';
    serveTimer = 0;
    ball.speed = 0; ball.vx = 0; ball.vy = 0;
    var total = scores[0] + scores[1];
    var per = (scores[0] >= 10 && scores[1] >= 10) ? 1 : 2;
    server = (Math.floor(total / per) % 2 === 0) ? 0 : 1;
    positionServeBall();
    sendNetState();
  }
  function positionServeBall() {
    var px = server === 0
      ? S.PADDLE_X[0] + S.PADDLE_W + S.BALL_R + 6
      : S.PADDLE_X[1] - S.BALL_R - 6;
    ball.x = px;
    ball.y = paddles[server].y;
  }
  function launchServe() {
    if (phase !== 'serve') return;
    var dir = server === 0 ? 1 : -1;
    var ang = (Math.random() * 0.42 - 0.21); // ±~24 degrees
    ball.speed = 620;
    ball.vx = Math.cos(ang) * ball.speed * dir;
    ball.vy = Math.sin(ang) * ball.speed;
    phase = 'rally';
    rallyHits = 0;
    trail.length = 0;
    sendNetState();
  }
  function startGame(m) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    mode = m;
    scores = [0, 0];
    bestRally = 0;
    winner = -1;
    paddles[0].y = paddles[0].target = H / 2;
    paddles[1].y = paddles[1].target = H / 2;
    applyModeNames();
    document.getElementById('lobbyPanel').classList.add('hidden');
    document.getElementById('overPanel').classList.add('hidden');
    setServe();
  }
  function applyModeNames() {
    if (mode === 'ai') { names = ['You', 'Computer']; colors = [S.COLORS[0].hex, S.COLORS[1].hex]; }
    else if (mode === 'local') { names = ['Player 1', 'Player 2']; colors = [S.COLORS[0].hex, S.COLORS[2].hex]; }
    else { // phone: joined players override in net code
      if (!net.sides[0]) { names[0] = 'Guest (TV)'; colors[0] = S.COLORS[0].hex; }
      if (!net.sides[1]) { names[1] = 'Computer'; colors[1] = S.COLORS[1].hex; }
    }
  }
  function scorePoint(scorer) {
    scores[scorer]++;
    lastScorer = scorer;
    pointFlash = 1;
    bestRally = Math.max(bestRally, rallyHits);
    burst(ball.x, ball.y, colors[scorer], quality === 2 ? 26 : 12);
    var lead = Math.abs(scores[0] - scores[1]);
    var top = Math.max(scores[0], scores[1]);
    if (top >= S.WIN_SCORE && lead >= S.WIN_LEAD) {
      winner = scores[0] > scores[1] ? 0 : 1;
      gamesWon[winner]++;
      phase = 'over';
      winBurst();
      showGameOver();
    } else {
      phase = 'point';
      pointTimer = 0;
    }
    sendNetState();
  }
  function showGameOver() {
    document.getElementById('overTitle').innerHTML =
      '<span class="winner-name">' + escapeHtml(names[winner]) + '</span> WINS';
    document.getElementById('overScore').textContent = scores[0] + ' — ' + scores[1];
    document.getElementById('overSub').textContent =
      'Best rally: ' + bestRally + ' hits · Games: ' + names[0] + ' ' + gamesWon[0] +
      ' · ' + names[1] + ' ' + gamesWon[1];
    var p = document.getElementById('overPanel');
    p.classList.remove('hidden');
    document.getElementById('btnAgain').focus();
  }
  function toLobby() {
    phase = 'lobby';
    document.getElementById('overPanel').classList.add('hidden');
    var p = document.getElementById('lobbyPanel');
    p.classList.remove('hidden');
    document.getElementById('btnModeAI').focus();
    sendNetState();
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- particles ---------------- */
  function burst(x, y, color, n) {
    if (quality === 0) return;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 420;
      particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.7 + Math.random() * 0.5, t: 0, color: color, r: 3 + Math.random() * 5 });
    }
  }
  function winBurst() {
    if (quality === 0) return;
    var cx = winner === 0 ? W * 0.28 : W * 0.72;
    for (var i = 0; i < (quality === 2 ? 90 : 40); i++) {
      var a = Math.random() * Math.PI * 2, sp = 200 + Math.random() * 640;
      particles.push({ x: cx, y: H * 0.42, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 220,
        life: 1.1 + Math.random() * 0.9, t: 0,
        color: [colors[winner], '#ffffff', S.COLORS[0].hex][i % 3], r: 3 + Math.random() * 6 });
    }
  }
  function stepParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.vy += 620 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  /* ---------------- input ---------------- */
  function localControlled(side) {
    if (net.sides[side]) return false;               // a phone owns this side
    if (mode === 'local') return true;
    if (mode === 'ai') return side === 0;
    return side === 0;                                // phone mode: TV side is local fallback
  }
  function aiControlled(side) {
    if (net.sides[side]) return false;
    if (mode === 'local') return false;
    return side === 1;                                // right side is the computer in ai/phone modes
  }
  function stepLocalInput(side, dt) {
    var p = paddles[side];
    var up = false, down = false;
    if (side === 0) {
      up = keys['KeyW'] || (mode !== 'local' && keys['ArrowUp']);
      down = keys['KeyS'] || (mode !== 'local' && keys['ArrowDown']);
    } else {
      up = keys['ArrowUp']; down = keys['ArrowDown'];
    }
    if (up) p.target -= HUMAN_SPEED * dt;
    if (down) p.target += HUMAN_SPEED * dt;
    p.target = clampPaddleY(p.target);
  }
  function stepAI(side, dt) {
    var p = paddles[side];
    var toward = (side === 1 && ball.vx > 0) || (side === 0 && ball.vx < 0);
    var target;
    if (phase === 'rally' && toward) target = ball.y + aiError[side];
    else if (phase === 'serve') target = H / 2 + Math.sin(performance.now() / 700) * 60;
    else target = H / 2;
    var d = target - p.y;
    var maxStep = AI_SPEED * dt;
    p.y += S.clamp(d, -maxStep, maxStep);
    p.y = clampPaddleY(p.y);
    p.target = p.y;
  }
  function stepPhonePaddle(side, dt) {
    var p = paddles[side];
    var k = Math.min(1, dt * 16);
    p.y += (p.target - p.y) * k;
    p.y = clampPaddleY(p.y);
  }
  function stepLocalPaddle(side, dt) {
    var p = paddles[side];
    var k = Math.min(1, dt * 22);
    p.y += (p.target - p.y) * k;
    p.y = clampPaddleY(p.y);
  }

  /* ---------------- physics ---------------- */
  function stepBall(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (quality === 2) {
      trail.push({ x: ball.x, y: ball.y });
      if (trail.length > 14) trail.shift();
    }
    if (ball.y - S.BALL_R < courtTop()) { ball.y = courtTop() + S.BALL_R; ball.vy = Math.abs(ball.vy); }
    if (ball.y + S.BALL_R > courtBottom()) { ball.y = courtBottom() - S.BALL_R; ball.vy = -Math.abs(ball.vy); }
    for (var side = 0; side < 2; side++) {
      var px = S.PADDLE_X[side];
      var p = paddles[side];
      var moving = side === 0 ? ball.vx < 0 : ball.vx > 0;
      if (!moving) continue;
      var inX = side === 0
        ? (ball.x - S.BALL_R <= px + S.PADDLE_W && ball.x - S.BALL_R >= px - 90)
        : (ball.x + S.BALL_R >= px && ball.x + S.BALL_R <= px + S.PADDLE_W + 90);
      var inY = Math.abs(ball.y - p.y) <= S.PADDLE_H / 2 + S.BALL_R;
      if (inX && inY) {
        var off = S.clamp((ball.y - p.y) / (S.PADDLE_H / 2), -1, 1);
        var ang = off * 1.08; // up to ~62 degrees
        ball.speed = Math.min(MAX_SPEED, ball.speed * SPEED_UP);
        var dir = side === 0 ? 1 : -1;
        ball.vx = Math.cos(ang) * ball.speed * dir;
        ball.vy = Math.sin(ang) * ball.speed;
        ball.x = side === 0 ? px + S.PADDLE_W + S.BALL_R + 1 : px - S.BALL_R - 1;
        rallyHits++;
        aiError[1 - side] = (Math.random() * 2 - 1) * (46 + rallyHits * 3);
        if (quality === 2) burst(ball.x, ball.y, '#ffffff', 4);
      }
    }
    if (ball.x < COURT.x - 60) scorePoint(1);
    else if (ball.x > COURT.x + COURT.w + 60) scorePoint(0);
  }

  function update(dt) {
    if (phase === 'lobby' || phase === 'over') { stepParticles(dt); return; }
    for (var side = 0; side < 2; side++) {
      if (net.sides[side]) stepPhonePaddle(side, dt);
      else if (aiControlled(side)) stepAI(side, dt);
      else { stepLocalInput(side, dt); stepLocalPaddle(side, dt); }
    }
    if (phase === 'serve') {
      positionServeBall();
      serveTimer += dt;
      var serverIsAI = aiControlled(server);
      var serverIsPhone = !!net.sides[server];
      if (serveTimer > 1.15 && !serverIsPhone) launchServe();
      else if (serveTimer > 6 && serverIsPhone) launchServe(); // never stall a phone game
      else if (serverIsAI && serveTimer > 0.9) launchServe();
    } else if (phase === 'rally') {
      stepBall(dt);
    } else if (phase === 'point') {
      pointTimer += dt;
      stepParticles(dt);
      if (pointTimer > 1.15) setServe();
    }
    if (pointFlash > 0) pointFlash = Math.max(0, pointFlash - dt * 1.4);
    stepParticles(dt);
  }

  /* ---------------- rendering ---------------- */
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.max(0, ((n >> 16) & 255) * f));
    var g = Math.min(255, Math.max(0, ((n >> 8) & 255) * f));
    var b = Math.min(255, Math.max(0, (n & 255) * f));
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }
  function drawStaticScene() {
    /* arena background: deep navy with a soft spotlight pool */
    ctx.fillStyle = '#081831';
    ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 1050);
    glow.addColorStop(0, 'rgba(46,96,160,0.55)');
    glow.addColorStop(0.55, 'rgba(23,54,102,0.28)');
    glow.addColorStop(1, 'rgba(4,10,24,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    /* table shadow + surface */
    if (quality === 2) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 46; ctx.shadowOffsetY = 26; }
    var tg = ctx.createLinearGradient(COURT.x, COURT.y, COURT.x + COURT.w, COURT.y + COURT.h);
    tg.addColorStop(0, '#17507f');
    tg.addColorStop(0.5, '#123f6b');
    tg.addColorStop(1, '#0d2c52');
    ctx.fillStyle = tg;
    rr(COURT.x, COURT.y, COURT.w, COURT.h, 14);
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    /* gloss sheen */
    if (quality > 0) {
      var sheen = ctx.createLinearGradient(COURT.x, COURT.y, COURT.x + COURT.w * 0.7, COURT.y + COURT.h);
      sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
      sheen.addColorStop(0.35, 'rgba(255,255,255,0.02)');
      sheen.addColorStop(0.6, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      rr(COURT.x, COURT.y, COURT.w, COURT.h, 14);
      ctx.fill();
    }
    /* table edge lines */
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 5;
    rr(COURT.x + 8, COURT.y + 8, COURT.w - 16, COURT.h - 16, 10);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(201,162,39,0.5)';
    ctx.lineWidth = 2;
    rr(COURT.x - 6, COURT.y - 6, COURT.w + 12, COURT.h + 12, 18);
    ctx.stroke();

    /* net: posts, mesh, white top tape */
    var nx = W / 2;
    if (quality === 2) { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 16; ctx.shadowOffsetX = 8; }
    ctx.fillStyle = 'rgba(6,16,34,0.88)';
    ctx.fillRect(nx - 7, COURT.y - 30, 14, COURT.h + 60);
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0;
    if (quality > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var gy = COURT.y - 24; gy < COURT.y + COURT.h + 24; gy += 17) { ctx.moveTo(nx - 7, gy); ctx.lineTo(nx + 7, gy); }
      for (var gx = nx - 6; gx <= nx + 6; gx += 6) { ctx.moveTo(gx, COURT.y - 28); ctx.lineTo(gx, COURT.y + COURT.h + 28); }
      ctx.stroke();
    }
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(nx - 8, COURT.y - 32, 16, 9);
    ctx.fillStyle = '#0a1c38';
    ctx.fillRect(nx - 13, COURT.y - 44, 26, 14);
    ctx.fillRect(nx - 13, COURT.y + COURT.h + 30, 26, 14);
  }

  /* The arena, gloss table and net never move, so they are rendered
     once per quality level into an offscreen layer and blitted each
     frame; only score, paddles, ball and particles draw per frame.
     That is what keeps the premium finish at 60 fps on a TV GPU. */
  var staticLayer = null;
  function buildStatic() {
    var layer = document.createElement('canvas');
    layer.width = W; layer.height = H;
    var keep = ctx;
    ctx = layer.getContext('2d');
    drawStaticScene();
    ctx = keep;
    staticLayer = layer;
  }

  function draw(now) {
    if (!staticLayer) buildStatic();
    ctx.drawImage(staticLayer, 0, 0);

    /* scoreboard */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 34px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = colors[0];
    ctx.fillText(names[0].toUpperCase(), W * 0.30, 66);
    ctx.fillStyle = colors[1];
    ctx.fillText(names[1].toUpperCase(), W * 0.70, 66);
    var pulse = 1 + pointFlash * 0.25;
    ctx.font = '900 ' + Math.round(96 * pulse) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(scores[0] + '  :  ' + scores[1], W / 2, 70);
    ctx.font = '700 24px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(184,196,214,0.9)';
    if (gamesWon[0] || gamesWon[1]) ctx.fillText('games  ' + gamesWon[0] + ' — ' + gamesWon[1], W / 2, 128);

    /* serve indicator */
    if (phase === 'serve') {
      var sx = server === 0 ? S.PADDLE_X[0] + 60 : S.PADDLE_X[1] + S.PADDLE_W - 60;
      ctx.beginPath();
      ctx.arc(sx, paddles[server].y - S.PADDLE_H / 2 - 36, 11 + Math.sin(now / 220) * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = S.COLORS[0].hex;
      ctx.fill();
      ctx.font = '800 25px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText(names[server] + ' to serve', W / 2, COURT.y + COURT.h + 62);
    }

    /* paddles */
    for (var i = 0; i < 2; i++) {
      var px = S.PADDLE_X[i], py = paddles[i].y - S.PADDLE_H / 2;
      if (quality === 2) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 10; }
      var pg = ctx.createLinearGradient(px, py, px + S.PADDLE_W, py);
      pg.addColorStop(0, shade(colors[i], 1.18));
      pg.addColorStop(0.5, colors[i]);
      pg.addColorStop(1, shade(colors[i], 0.62));
      ctx.fillStyle = pg;
      rr(px, py, S.PADDLE_W, S.PADDLE_H, 13);
      ctx.fill();
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      var inset = i === 0 ? 5 : 11;
      rr(px + inset - 5 + (i === 0 ? 5 : 0), py + 10, 10, S.PADDLE_H - 20, 5);
      ctx.fill();
    }

    /* ball trail + ball */
    var bx = ball.x, by = ball.y;
    if (phase === 'lobby') { by = H / 2 + Math.sin(now / 620) * 46; bx = W / 2; }
    if (quality === 2 && phase === 'rally') {
      for (var t = 0; t < trail.length; t++) {
        var a = (t / trail.length) * 0.20;
        ctx.beginPath();
        ctx.arc(trail[t].x, trail[t].y, S.BALL_R * (0.4 + 0.6 * t / trail.length), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
        ctx.fill();
      }
    }
    if (phase !== 'point') {
      ctx.beginPath();
      ctx.ellipse(bx + 8, by + 16, S.BALL_R * 1.05, S.BALL_R * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      var bg = ctx.createRadialGradient(bx - 5, by - 6, 2, bx, by, S.BALL_R + 2);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(0.65, '#e8edf4');
      bg.addColorStop(1, '#9fb0c4');
      ctx.beginPath();
      ctx.arc(bx, by, S.BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = bg;
      ctx.fill();
    }

    /* particles */
    for (var j = 0; j < particles.length; j++) {
      var p = particles[j];
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* point banner */
    if (phase === 'point' && lastScorer >= 0) {
      var sc = 0.7 + pointFlash * 0.5;
      ctx.font = '900 ' + Math.round(92 * sc) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = colors[lastScorer];
      ctx.fillText('POINT — ' + names[lastScorer].toUpperCase(), W / 2, H / 2 - 40);
      ctx.font = '700 30px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('rally: ' + rallyHits + ' hits', W / 2, H / 2 + 34);
    }
    if (phase === 'serve') {
      ctx.font = '700 27px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = 'rgba(184,196,214,0.95)';
      var hint = net.sides[server] ? 'Waiting for ' + names[server] + ' to serve from the phone…'
        : (aiControlled(server) ? 'Computer serves…' : 'Press ENTER or tap to serve');
      ctx.fillText(hint, W / 2, COURT.y + COURT.h + 104);
    }
  }

  /* ---------------- networking (PeerJS) ---------------- */
  var net = {
    peer: null, status: 'idle', code: '', tries: 0,
    sides: [null, null],        // side -> {conn, name, color, token}
    spectators: [],
    openTimer: null,
    lastIncoming: null          // peer id of the most recent real incoming connection
  };
  function controllerUrl() {
    var base = window.location.href.split('#')[0].split('?')[0];
    return base.substring(0, base.lastIndexOf('/') + 1) + 'controller.html';
  }
  function setDot(cls) {
    var d = document.getElementById('netDot');
    d.className = 'dot' + (cls ? ' ' + cls : '');
  }
  function netOffline(reason) {
    net.status = 'offline';
    setDot('off');
    var b = document.getElementById('netBanner');
    b.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = '📱 Phone controllers need an internet connection (they reach this TV through the PeerJS cloud) — none was found (' +
      reason + '). The game still works right here: 1 Player vs Computer, or 2 Players on this screen.';
    var btn = document.createElement('button');
    btn.className = 'btn btn-outline';
    btn.textContent = 'Retry phone connection';
    btn.addEventListener('click', function () { b.classList.add('hidden'); initPeer(); });
    b.appendChild(span);
    b.appendChild(btn);
    b.classList.remove('hidden');
  }
  function initPeer() {
    if (typeof window.Peer === 'undefined') { netOffline('controller library unavailable'); return; }
    net.status = 'connecting';
    setDot('');
    net.code = S.makeRoomCode();
    document.getElementById('roomCode').textContent = net.code;
    var peer;
    try {
      peer = new window.Peer(S.peerIdFor(net.code), S.brokerOptions());
    } catch (e) {
      netOffline('connection setup failed');
      return;
    }
    net.peer = peer;
    clearTimeout(net.openTimer);
    net.openTimer = setTimeout(function () {
      if (net.status !== 'online') { try { peer.destroy(); } catch (e) {} netOffline('timed out'); }
    }, 9000);
    peer.on('open', function () {
      net.status = 'online';
      net.tries = 0;
      clearTimeout(net.openTimer);
      setDot('on');
      document.getElementById('netBanner').classList.add('hidden');
      document.getElementById('lobbyHint').textContent =
        'Phone controller: ' + controllerUrl() + ' — enter room code ' + net.code + '.';
    });
    peer.on('connection', setupConn);
    peer.on('disconnected', function () { if (net.status === 'online') { try { peer.reconnect(); } catch (e) {} } });
    peer.on('error', function (err) {
      var type = err && err.type ? err.type : 'unknown';
      if (type === 'unavailable-id' && net.tries < 3) {
        net.tries++;
        try { peer.destroy(); } catch (e) {}
        initPeer();
        return;
      }
      if (net.status !== 'online') netOffline(type);
    });
  }
  function setupConn(conn) {
    net.lastIncoming = conn.peer || null;
    var entry = { conn: conn, side: -1, name: '', color: '', token: '' };
    conn.on('data', function (data) {
      if (!data || typeof data !== 'object') return;
      if (data.t === 'join') {
        entry.name = String(data.name || 'Player').slice(0, 14);
        entry.color = String(data.color || S.COLORS[0].hex);
        entry.token = String(data.token || '');
        var side = -1;
        if (entry.token) {
          for (var i = 0; i < 2; i++) {
            if (net.sides[i] && net.sides[i].token === entry.token) side = i;
          }
        }
        if (side === -1) { for (var j = 0; j < 2; j++) { if (!net.sides[j]) { side = j; break; } } }
        entry.side = side;
        if (side >= 0) {
          net.sides[side] = entry;
          names[side] = entry.name;
          colors[side] = entry.color;
          if (phase === 'lobby') mode = 'phone';
          conn.send({ t: 'welcome', side: side, name: entry.name, color: entry.color });
        } else {
          net.spectators.push(entry);
          conn.send({ t: 'full' });
        }
        refreshJoined();
        sendNetState();
      } else if (data.t === 'pad' && entry.side >= 0) {
        paddles[entry.side].target = y01ToPx(parseFloat(data.y) || 0.5);
      } else if (data.t === 'serve' && entry.side >= 0) {
        if (phase === 'serve' && entry.side === server) launchServe();
        else if (phase === 'lobby') startGame('phone');
        else if (phase === 'over') startGame(mode);
      }
    });
    conn.on('close', function () {
      if (entry.side >= 0 && net.sides[entry.side] === entry) {
        net.sides[entry.side] = null;
        if (mode === 'phone') applyModeNames();
      }
      var si = net.spectators.indexOf(entry);
      if (si >= 0) net.spectators.splice(si, 1);
      refreshJoined();
      sendNetState();
    });
  }
  function sendNetState() {
    var base = { t: 'state', phase: phase, mode: mode, scores: scores.slice(),
      names: names.slice(), colors: colors.slice(), server: server };
    var all = net.sides.concat(net.spectators);
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (!e || !e.conn || !e.conn.open) continue;
      var msg = {}; for (var k in base) msg[k] = base[k];
      msg.you = e.side;
      msg.yourServe = e.side === server && phase === 'serve';
      try { e.conn.send(msg); } catch (err) {}
    }
  }
  setInterval(sendNetState, 1000);
  function refreshJoined() {
    var list = document.getElementById('joinedList');
    list.innerHTML = '';
    var any = false;
    for (var i = 0; i < 2; i++) {
      var e = net.sides[i];
      if (!e) continue;
      any = true;
      var chip = document.createElement('span');
      chip.className = 'player-chip';
      chip.style.background = e.color;
      chip.textContent = '📱 ' + e.name + ' — ' + (i === 0 ? 'LEFT' : 'RIGHT');
      list.appendChild(chip);
    }
    if (!any) {
      var p = document.createElement('span');
      p.className = 'pill';
      p.textContent = 'No phones yet — the game still plays on this screen';
      list.appendChild(p);
    }
  }

  /* ---------------- UI + input wiring ---------------- */
  document.getElementById('btnModeAI').addEventListener('click', function () { startGame('ai'); });
  document.getElementById('btnModeLocal').addEventListener('click', function () { startGame('local'); });
  document.getElementById('btnModePhone').addEventListener('click', function () { startGame('phone'); });
  document.getElementById('btnAgain').addEventListener('click', function () { startGame(mode); });
  document.getElementById('btnLobby').addEventListener('click', function () { toLobby(); });

  document.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Space') e.preventDefault();
    var onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if (e.code === 'Enter' || e.code === 'Space') {
      if (onButton) return; // focused button handles it natively
      if (phase === 'lobby') startGame('ai');
      else if (phase === 'serve' && !net.sides[server]) launchServe();
      else if (phase === 'over') startGame(mode);
    }
    if (phase === 'lobby' && !onButton) {
      if (e.code === 'Digit1') startGame('ai');
      else if (e.code === 'Digit2') startGame('local');
      else if (e.code === 'Digit3') startGame('phone');
    }
    if (e.code === 'KeyM' && phase !== 'lobby') toLobby();
    if (e.code === 'Escape' && phase === 'over') toLobby();
  });
  document.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; });

  function canvasPosY(e) {
    var r = canvas.getBoundingClientRect();
    var clientY = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    return S.clamp((clientY - r.top) / r.height, 0, 1) * H;
  }
  canvas.addEventListener('mousemove', function (e) {
    if (localControlled(0) && !net.sides[0] && mode !== 'local') paddles[0].target = clampPaddleY(canvasPosY(e));
  });
  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (phase === 'serve' && !net.sides[server]) launchServe();
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (localControlled(0) && !net.sides[0] && mode !== 'local') paddles[0].target = clampPaddleY(canvasPosY(e));
  }, { passive: false });
  canvas.addEventListener('click', function () {
    if (phase === 'serve' && !net.sides[server]) launchServe();
  });

  /* ---------------- debug / test hooks (used by check-pingpong.py) ---------------- */
  window.PP = {
    version: '1.0.0',
    getState: function () {
      return {
        phase: phase, mode: mode, scores: scores.slice(), server: server,
        winner: winner, quality: quality, rallyHits: rallyHits, bestRally: bestRally,
        ball: { x: Math.round(ball.x), y: Math.round(ball.y), vx: Math.round(ball.vx), vy: Math.round(ball.vy) },
        paddles: [Math.round(paddles[0].y), Math.round(paddles[1].y)],
        net: { status: net.status, code: net.code, sawIncoming: net.lastIncoming,
               sides: [!!net.sides[0], !!net.sides[1]] }
      };
    },
    start: function (m) { startGame(m || 'ai'); },
    serve: function () { launchServe(); },
    toLobby: function () { toLobby(); },
    setScore: function (a, b) {
      scores = [a | 0, b | 0];
      var lead = Math.abs(scores[0] - scores[1]);
      if (Math.max(scores[0], scores[1]) >= S.WIN_SCORE && lead >= S.WIN_LEAD) {
        winner = scores[0] > scores[1] ? 0 : 1;
        phase = 'over';
        showGameOver();
      } else setServe();
      sendNetState();
    },
    setPaddle: function (side, y01) {
      paddles[side].y = paddles[side].target = y01ToPx(y01);
    },
    setBall: function (x, y, vx, vy) {
      ball.x = x; ball.y = y; ball.vx = vx; ball.vy = vy;
      if (phase === 'serve') phase = 'rally';
    },
    /* Simulated-peer hooks: run join/pad/serve messages through the
       exact setupConn data handler a live PeerJS connection uses, with
       a stub transport. (The sandbox blocks WebRTC's UDP data plane,
       so check-pingpong.py verifies the wire at signaling level and
       the protocol through these hooks.) */
    simJoin: function (name) {
      var stub = { open: true, peer: 'simulated-peer', sent: [], _h: {},
        on: function (ev, fn) { this._h[ev] = fn; },
        send: function (m) { this.sent.push(m); },
        emit: function (ev, arg) { if (this._h[ev]) this._h[ev](arg); } };
      setupConn(stub);
      stub.emit('data', { t: 'join', name: name || 'Sim Player', color: S.COLORS[1].hex, token: 'sim-token' });
      var side = -1;
      for (var i = 0; i < stub.sent.length; i++) if (stub.sent[i].t === 'welcome') side = stub.sent[i].side;
      if (side >= 0) simStubs[side] = stub;
      return { side: side, sent: stub.sent };
    },
    simData: function (side, msg) {
      var stub = simStubs[side];
      if (stub) stub.emit('data', msg);
    },
    simState: function (side) {
      var stub = simStubs[side];
      if (!stub) return null;
      for (var i = stub.sent.length - 1; i >= 0; i--) if (stub.sent[i].t === 'state') return stub.sent[i];
      return null;
    }
  };
  var simStubs = [null, null];

  /* ---------------- main loop + boot ---------------- */
  var last = performance.now();
  function tick(now) {
    var dtMs = now - last;
    last = now;
    var dt = Math.min(0.033, dtMs / 1000);
    noteFrame(dtMs);
    if (phase !== 'lobby') update(dt);
    else stepParticles(dt);
    draw(now);
    requestAnimationFrame(tick);
  }
  refreshJoined();
  initPeer();
  document.getElementById('btnModeAI').focus();
  requestAnimationFrame(tick);
})();
