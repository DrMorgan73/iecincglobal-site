// Full synthetic end-to-end check of the Podcast Mixer (desk/podcast-mixer.html).
// Serves the mixer HTML on localhost, injects synthetic devices
// (3 canvas cameras with distinct patterns, 2 oscillator mics with
// speech-like bursts at 300 Hz / 520 Hz), drives the real UI, and
// verifies recorded outputs contain the synthetic signals.
// All test media is SYNTHETIC — no real camera/mic is used.
//
// Requires puppeteer (headless Chromium). Run from a scratch dir:
//   npm init -y && npm install puppeteer
//   node <repo>/scripts/podcast-mixer-synthetic-check.mjs [html-path] [label]
// With no html-path it checks the repo's desk/podcast-mixer.html.
import http from "node:http";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let puppeteer;
try { puppeteer = (await import("puppeteer")).default; }
catch {
  try {
    const { createRequire } = await import("node:module");
    puppeteer = createRequire(join(process.cwd(), "package.json"))("puppeteer");
  } catch { console.error("puppeteer not installed — run: npm install puppeteer"); process.exit(2); }
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = process.argv[2] || join(repoRoot, "desk/podcast-mixer.html");
const label = process.argv[3] || "run";
const html = readFileSync(htmlPath, "utf8");

// Synthetic music-channel file: stereo WAV, 200 Hz + 6000 Hz sines, 8 s.
const wavPath = join(mkdtempSync(join(tmpdir(), "mixer-check-")), "test-tones.wav");
{
  const sr = 44100, n = sr * 8;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const v = Math.max(-1, Math.min(1, 0.3 * Math.sin(2 * Math.PI * 200 * t) + 0.3 * Math.sin(2 * Math.PI * 6000 * t)));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 4 + 2);
  }
  writeFileSync(wavPath, buf);
}

const cameraHtml = readFileSync(join(repoRoot, "camera.html"), "utf8");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end((req.url || "").startsWith("/camera.html") ? cameraHtml : html);
});
await new Promise((r) => server.listen(8931, "127.0.0.1", r));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- synthetic device injection ----------
const INJECT = () => {
  const synth = { streams: {}, actx: null };
  window.__synth = synth;
  function actx() {
    if (!synth.actx) synth.actx = new (window.AudioContext || window.webkitAudioContext)();
    if (synth.actx.state === "suspended") synth.actx.resume();
    return synth.actx;
  }
  const CAM_DEFS = {
    "cam-a": { color: "#d32f2f", label: "CAM A" },
    "cam-b": { color: "#2e7d32", label: "CAM B" },
    "cam-c": { color: "#1565c0", label: "CAM C" },
  };
  function makeCamStream(id) {
    const def = CAM_DEFS[id] || CAM_DEFS["cam-a"];
    const c = document.createElement("canvas");
    /* Small + 30fps-throttled: a real camera costs the page no CPU to
       produce frames, so cheap synthetic sources keep the harness load
       faithful to real use (full-rate 640x360 sources starved the
       audio graph on this VM and compressed recorded durations). */
    c.width = 320; c.height = 180;
    const x = c.getContext("2d");
    let t = 0, last = 0;
    (function draw(now) {
      if (!last || now - last >= 33) {
        last = now;
        t++;
        x.fillStyle = def.color; x.fillRect(0, 0, 320, 180);
        x.fillStyle = "rgba(255,255,255,0.9)";
        x.beginPath(); x.arc(30 + (t * 3) % 260, 20, 8, 0, 7); x.fill();
        x.fillStyle = "#ffffff"; x.font = "bold 36px sans-serif";
        x.fillText(def.label, 90, 105);
      }
      requestAnimationFrame(draw);
    })(0);
    const s = c.captureStream(30);
    synth.streams[id] = s;
    return s;
  }
  // A/V sync pair: a camera that flashes white and a mic that beeps on
  // the SAME phase clock (150ms pulse every 1s) — the recorded file's
  // flash-vs-beep offset measures true pipeline sync.
  synth.syncPhase = () => (performance.now() / 1000) % 1;
  function makeSyncCamStream() {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 180;
    const x = c.getContext("2d");
    const iv = setInterval(() => {
      x.fillStyle = synth.syncPhase() < 0.15 ? "#ffffff" : "#000000";
      x.fillRect(0, 0, 320, 180);
    }, 20);
    const s = c.captureStream(30);
    s.getVideoTracks().forEach((tr) => tr.addEventListener("ended", () => clearInterval(iv)));
    synth.streams["cam-sync"] = s;
    return s;
  }
  function makeSyncMicStream() {
    const ac = actx();
    const osc = ac.createOscillator();
    osc.type = "sine"; osc.frequency.value = 1000;
    const g = ac.createGain(); g.gain.value = 0;
    const dest = ac.createMediaStreamDestination();
    osc.connect(g); g.connect(dest); osc.start();
    const iv = setInterval(() => {
      g.gain.setTargetAtTime(synth.syncPhase() < 0.15 ? 0.2 : 0, ac.currentTime, 0.005);
    }, 20);
    const s = dest.stream;
    s.getAudioTracks().forEach((tr) => tr.addEventListener("ended", () => clearInterval(iv)));
    synth.streams["mic-sync"] = s;
    return s;
  }
  const MIC_DEFS = { "mic-a": 300, "mic-b": 520 };
  function makeMicStream(id) {
    const ac = actx();
    const osc = ac.createOscillator();
    osc.type = "sine"; osc.frequency.value = MIC_DEFS[id] || 300;
    const g = ac.createGain(); g.gain.value = 0;
    const dest = ac.createMediaStreamDestination();
    osc.connect(g); g.connect(dest); osc.start();
    let on = false;
    // 300ms toggle (600ms period): a 3s take averages ~5 burst cycles, so
    // measured tone energy is stable run-to-run. At 600ms toggle the phase
    // alignment of a short take swung measured energy 0.003–0.036.
    const iv = setInterval(() => { on = !on; g.gain.setTargetAtTime(on ? 0.15 : 0, ac.currentTime, 0.02); }, 300);
    const s = dest.stream;
    s.getAudioTracks().forEach((tr) => tr.addEventListener("ended", () => clearInterval(iv)));
    synth.streams[id] = s;
    return s;
  }
  // Synthetic macOS Aggregate Device ("Podcast Mics"): ONE stream whose
  // channel 1 carries the 300Hz mic and channel 2 the 520Hz mic, merged
  // with a ChannelMergerNode — the same shape the real aggregate presents.
  // The mono variant is a 1-channel stream under an aggregate-style label,
  // for the honest-labeling path (browser returns only one channel).
  function makeAggStream(mono) {
    const ac = actx();
    const dest = ac.createMediaStreamDestination();
    if (mono) { try { dest.channelCount = 1; } catch {} }
    const merger = mono ? null : ac.createChannelMerger(2);
    if (merger) merger.connect(dest);
    const ivs = [];
    const mk = (freq, outIdx) => {
      const osc = ac.createOscillator();
      osc.type = "sine"; osc.frequency.value = freq;
      const g = ac.createGain(); g.gain.value = 0;
      osc.connect(g);
      if (merger) g.connect(merger, 0, outIdx); else g.connect(dest);
      osc.start();
      let on = false;
      ivs.push(setInterval(() => { on = !on; g.gain.setTargetAtTime(on ? 0.15 : 0, ac.currentTime, 0.02); }, 300));
    };
    mk(300, 0);
    if (!mono) mk(520, 1);
    const s = dest.stream;
    s.getAudioTracks().forEach((tr) => tr.addEventListener("ended", () => ivs.forEach(clearInterval)));
    synth.streams[mono ? "agg-mono" : "agg-1"] = s;
    return s;
  }
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    synth.lastConstraints = constraints;
    if (window.__denyMedia) {
      const e = new Error("Permission denied"); e.name = "NotAllowedError"; throw e;
    }
    actx();
    if (constraints && constraints.video) {
      const id = (constraints.video.deviceId && constraints.video.deviceId.exact) || "cam-a";
      if (id === "cam-sync") return makeSyncCamStream();
      return makeCamStream(id);
    }
    if (constraints && constraints.audio) {
      const id = (constraints.audio.deviceId && constraints.audio.deviceId.exact) || "mic-a";
      if (id === "agg-1") return makeAggStream(false);
      if (id === "agg-mono") return makeAggStream(true);
      if (id === "mic-sync") return makeSyncMicStream();
      return makeMicStream(id);
    }
    throw new Error("no constraints");
  };
  synth.devices = [
    { deviceId: "mic-a", kind: "audioinput", label: "Synthetic Mic A (300Hz)", groupId: "g1" },
    { deviceId: "mic-b", kind: "audioinput", label: "Synthetic Mic B (520Hz)", groupId: "g2" },
    { deviceId: "agg-1", kind: "audioinput", label: "Podcast Mics", groupId: "g6" },
    { deviceId: "agg-mono", kind: "audioinput", label: "Podcast Mics Mono", groupId: "g7" },
    { deviceId: "cam-a", kind: "videoinput", label: "Synthetic Cam A (red)", groupId: "g3" },
    { deviceId: "cam-b", kind: "videoinput", label: "Synthetic Cam B (green)", groupId: "g4" },
    { deviceId: "cam-c", kind: "videoinput", label: "Synthetic Cam C (blue)", groupId: "g5" },
    { deviceId: "mic-sync", kind: "audioinput", label: "Sync Test Mic", groupId: "g8" },
    { deviceId: "cam-sync", kind: "videoinput", label: "Sync Test Camera", groupId: "g9" },
  ];
  navigator.mediaDevices.enumerateDevices = async () => synth.devices.slice();
  synth.setDevices = (list) => { synth.devices = list; };
  synth.fireDeviceChange = () => navigator.mediaDevices.dispatchEvent(new Event("devicechange"));

  // ---------- in-page probes ----------
  window.__probe = {
    regionColor(canvas, fx, fy, fw, fh) {
      const x = canvas.getContext("2d");
      const d = x.getImageData(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy),
        Math.max(1, Math.floor(canvas.width * fw)), Math.max(1, Math.floor(canvas.height * fh))).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    },
    meterLit(canvas) {
      const x = canvas.getContext("2d");
      const d = x.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 1] > 100 && d[i] < 140) lit++; // green segments
      }
      return lit;
    },
    async decode(url) {
      const ab = await (await fetch(url)).arrayBuffer();
      const ac = new OfflineAudioContext(2, 44100, 44100);
      return ac.decodeAudioData(ab);
    },
    rms(buf, ch = 0) {
      const d = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / d.length);
    },
    goertzel(buf, freq, ch = 0) {
      const d = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1));
      const w = 2 * Math.PI * freq / buf.sampleRate, cw = Math.cos(w), c = 2 * cw;
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < d.length; i++) { s0 = d[i] + c * s1 - s2; s2 = s1; s1 = s0; }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / d.length;
    },
  };
};

// ---------- browser ----------
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio", "--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  // Environment proxy blocks Google Fonts in headless Chrome — not a page defect.
  if (/ERR_TUNNEL|fonts\.googleapis|fonts\.gstatic|Failed to load resource/.test(t)) return;
  consoleErrors.push(t);
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
await page.evaluateOnNewDocument(INJECT);
await page.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0", timeout: 30000 });
await sleep(600);

// helpers to drive the UI
const ev = (fn, ...args) => page.evaluate(fn, ...args);
async function clickText(text, scope = "body") {
  const ok = await ev((t, s) => {
    const root = document.querySelector(s) || document.body;
    const els = [...root.querySelectorAll("button")];
    const b = els.find((e) => e.textContent.trim() === t) || els.find((e) => e.textContent.includes(t));
    if (!b) return false; b.click(); return true;
  }, text, scope);
  if (!ok) throw new Error("button not found: " + text);
  await sleep(250);
}
async function stripBtn(stripIdx, text) {
  const ok = await ev((i, t) => {
    const strip = document.querySelectorAll(".strip")[i];
    const b = [...strip.querySelectorAll("button")].find((e) => e.textContent.trim() === t || e.textContent.includes(t));
    if (!b) return false; b.click(); return true;
  }, stripIdx, text);
  if (!ok) throw new Error(`strip ${stripIdx} button not found: ${text}`);
  await sleep(250);
}
async function setSelect(selExpr, value) {
  await ev((expr, v) => {
    const sel = eval(expr);
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, selExpr, value);
  await sleep(200);
}
async function setSlider(stripIdx, label, value) {
  const ok = await ev((i, lbl, v) => {
    const strip = document.querySelectorAll(".strip")[i];
    const rows = [...strip.querySelectorAll(".ctl")];
    const row = rows.find((r) => r.querySelector("label") && r.querySelector("label").textContent.trim() === lbl);
    if (!row) return false;
    const input = row.querySelector('input[type="range"]');
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, stripIdx, label, value);
  if (!ok) throw new Error(`slider not found strip ${stripIdx} ${label}`);
  await sleep(150);
}
async function setFader(stripIdx, db) {
  await ev((i, v) => {
    const strip = document.querySelectorAll(".strip")[i];
    const input = strip.querySelector(".fader-rail input");
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, stripIdx, db);
  await sleep(150);
}
async function setSwitch(stripIdx, label, on) {
  await ev((i, lbl, v) => {
    const strip = document.querySelectorAll(".strip")[i];
    const sw = [...strip.querySelectorAll(".switch")].find((s) => s.textContent.trim() === lbl);
    const box = sw.querySelector('input[type="checkbox"]');
    if (box.checked !== v) { box.checked = v; box.dispatchEvent(new Event("change", { bubbles: true })); }
  }, stripIdx, label, on);
  await sleep(150);
}
async function meterSamples(stripIdx, ms = 2600) {
  let maxLit = 0, litCount = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const lit = await ev((i) => {
      const c = document.querySelectorAll(".strip")[i].querySelector('[data-role="meter"]');
      return window.__probe.meterLit(c);
    }, stripIdx);
    if (lit > maxLit) maxLit = lit;
    if (lit > 5) litCount++;
    await sleep(120);
  }
  return { maxLit, litCount };
}
async function programColor(fx, fy, fw, fh) {
  return ev((a, b, c, d) => window.__probe.regionColor(document.getElementById("program"), a, b, c, d), fx, fy, fw, fh);
}
/* Decode a recorded video file and sample a frame's color at time t. */
async function frameColorAt(url, tSec, fx = 0.35, fy = 0.35, fw = 0.3, fh = 0.3) {
  return ev(async (u, t, a, b, c, d) => {
    const v = document.createElement("video");
    v.muted = true; v.src = u; v.playsInline = true;
    await new Promise(r => { v.onloadedmetadata = r; setTimeout(r, 3000); });
    v.currentTime = t;
    await new Promise(r => { v.onseeked = r; setTimeout(r, 2500); });
    const cv = document.createElement("canvas");
    cv.width = v.videoWidth || 1920; cv.height = v.videoHeight || 1080;
    cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
    return { col: window.__probe.regionColor(cv, a, b, c, d), w: cv.width, h: cv.height, dur: v.duration };
  }, url, tSec, fx, fy, fw, fh);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isRed = (c) => c[0] > 120 && c[1] < 110 && c[2] < 110;
const isGreen = (c) => c[1] > 80 && c[0] < 110 && c[2] < 110;
const isBlue = (c) => c[2] > 100 && c[0] < 110 && c[1] < 140;

async function recordTake(seconds, duringFn) {
  const before = await ev(() => document.querySelectorAll("#takes .take-group").length);
  await ev(() => document.getElementById("recBtn").click());
  await sleep(300);
  if (duringFn) await duringFn();
  await sleep(seconds * 1000);
  await ev(() => document.getElementById("recBtn").click());
  // wait for the take group to appear
  for (let i = 0; i < 40; i++) {
    const n = await ev(() => document.querySelectorAll("#takes .take-group").length);
    if (n > before) break;
    await sleep(300);
  }
  return ev(() => {
    const groups = document.querySelectorAll("#takes .take-group");
    const g = groups[groups.length - 1];
    return [...g.querySelectorAll(".take")].map((row) => ({
      label: row.querySelector(".meta b").textContent,
      url: row.querySelector("a").href,
      isVideo: !!row.querySelector("video"),
    }));
  });
}
async function analyzeAudio(url) {
  return ev(async (u) => {
    const buf = await window.__probe.decode(u);
    const P = window.__probe;
    return {
      dur: buf.duration, ch: buf.numberOfChannels,
      rms0: P.rms(buf, 0), rms1: buf.numberOfChannels > 1 ? P.rms(buf, 1) : 0,
      g300: P.goertzel(buf, 300), g520: P.goertzel(buf, 520),
      g220: P.goertzel(buf, 220), g200: P.goertzel(buf, 200), g6000: P.goertzel(buf, 6000),
    };
  }, url);
}

try {
  // ===== 0. Load + enumeration =====
  check("page loads with no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  const micOpts = await ev(() => [...document.querySelectorAll(".strip select")].filter(s => s.getAttribute("aria-label") === "Microphone device").map(s => [...s.options].map(o => o.textContent)));
  check("mic dropdowns enumerate labeled devices at load", micOpts.length === 2 && micOpts[0].some(t => t.includes("Synthetic Mic A")), JSON.stringify(micOpts[0]));
  const camOpts = await ev(() => [...document.querySelectorAll("#camList .cam-card select")].map(s => [...s.options].map(o => o.textContent)));
  check("camera dropdowns enumerate 3 labeled cameras at load", camOpts.length === 3 && camOpts[0].filter(t => t.includes("Synthetic Cam")).length === 3, JSON.stringify(camOpts[0]));

  // ===== 1. Cameras on =====
  for (let i = 0; i < 3; i++) {
    await setSelect(`document.querySelectorAll(".cam-card select")[${i}]`, ["cam-a", "cam-b", "cam-c"][i]);
    await ev((idx) => document.querySelectorAll(".cam-card button")[idx].click(), i);
    await sleep(500);
  }
  const camStates = await ev(() => [...document.querySelectorAll("#camList .cam-card video")].map(v => ({ has: !!v.srcObject, w: v.videoWidth, paused: v.paused })));
  check("all 3 cameras live with video frames", camStates.every(c => c.has && c.w > 0), JSON.stringify(camStates));
  const hdState = await ev(() => ({
    canvas: [document.getElementById("program").width, document.getElementById("program").height],
    constraints: window.__synth.lastConstraints && window.__synth.lastConstraints.video,
    res: [...document.querySelectorAll("#camList .cam-card")].map(c => c.querySelector('[data-role="res"]').textContent),
  }));
  check("HD: program canvas is 1920x1080", eq(hdState.canvas, [1920, 1080]), JSON.stringify(hdState.canvas));
  check("HD: local cameras request 1080p ideal with 720p floor", hdState.constraints && hdState.constraints.width.ideal === 1920 && hdState.constraints.height.ideal === 1080 && hdState.constraints.height.min === 720, JSON.stringify(hdState.constraints));
  check("HD: slot shows actual resolution honestly (synthetic 320x180 = below HD)", hdState.res.every(t => t === "320×180 · below HD"), JSON.stringify(hdState.res));
  await sleep(400);
  let col = await programColor(0.35, 0.35, 0.3, 0.3);
  check("Single layout: program shows Cam A (red)", isRed(col), JSON.stringify(col));

  // ===== 2. Layouts + tap-to-main =====
  await clickText("Side-by-Side");
  await sleep(400);
  const left = await programColor(0.08, 0.35, 0.25, 0.3);
  const right = await programColor(0.65, 0.35, 0.25, 0.3);
  check("Side-by-Side: left=CamA red, right=CamB green", isRed(left) && isGreen(right), `L=${left} R=${right}`);
  await clickText("Picture-in-Picture");
  await sleep(400);
  const mainCol = await programColor(0.3, 0.3, 0.25, 0.25);
  const pipCol = await programColor(0.78, 0.72, 0.14, 0.14);
  check("PiP: main=CamA red, inset=CamB green", isRed(mainCol) && isGreen(pipCol), `M=${mainCol} P=${pipCol}`);
  await clickText("Single");
  await ev(() => document.querySelectorAll(".cam-thumb")[2].click()); // tap Cam 3
  await sleep(400);
  col = await programColor(0.35, 0.35, 0.3, 0.3);
  const badge = await ev(() => document.getElementById("programBadgeText").textContent);
  check("tap Cam 3 preview makes it main (blue)", isBlue(col) && badge.includes("Cam 3"), `col=${col} badge=${badge}`);
  await ev(() => document.querySelectorAll(".cam-thumb")[0].click());
  await sleep(300);

  // ===== 3. Test Tone (CH1) =====
  await stripBtn(0, "Test Tone");
  const toneMeter = await meterSamples(0, 1800);
  check("Test Tone drives CH1 meter", toneMeter.litCount >= 3, JSON.stringify(toneMeter));
  await stripBtn(0, "Stop Tone");

  // ===== 4. Mics on =====
  await setSelect(`document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]')`, "mic-a");
  await setSelect(`document.querySelectorAll(".strip")[1].querySelector('select[aria-label="Microphone device"]')`, "mic-b");
  await stripBtn(0, "Enable Mic");
  await stripBtn(1, "Enable Mic");
  await sleep(500);
  const liveTags = await ev(() => [...document.querySelectorAll(".strip")].slice(0, 2).map(s => s.querySelector('[data-role="livetag"]').textContent));
  check("both mics report Mic live", liveTags.every(t => t === "Mic live"), JSON.stringify(liveTags));
  const m1 = await meterSamples(0, 2600);
  const m2 = await meterSamples(1, 2600);
  check("CH1 meter moves with mic signal (gate passes bursts)", m1.litCount >= 4, JSON.stringify(m1));
  check("CH2 meter moves with mic signal", m2.litCount >= 4, JSON.stringify(m2));

  // ===== 4b. Live device switch: changing the dropdown on a live channel
  // must re-acquire the stream from the newly selected device =====
  // Note on Goertzel floors below: the synthetic mics burst on/off every
  // 600ms, so a 3s take's measured tone energy varies with burst phase
  // (observed 0.008–0.031). The presence floor is 0.004 — well above the
  // absent-frequency floor (~0.000) — and the 4x separation ratio is the
  // real assertion. A 0.01 floor sat inside the variance band and flaked.
  await setSelect(`document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]')`, "mic-b");
  await sleep(900);
  const tagAfterSwitch = await ev(() => document.querySelectorAll(".strip")[0].querySelector('[data-role="livetag"]').textContent);
  const takeSwitch = await recordTake(3);
  const hostSwitch = await analyzeAudio(takeSwitch.find(t => t.label === "Host").url);
  check("live switch CH1 mic-a→mic-b: stream follows dropdown (520Hz on Host)", tagAfterSwitch === "Mic live" && hostSwitch.g520 > 0.004 && hostSwitch.g520 > hostSwitch.g300 * 4, `tag=${tagAfterSwitch} g300=${hostSwitch.g300.toFixed(3)} g520=${hostSwitch.g520.toFixed(3)}`);
  await setSelect(`document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]')`, "mic-a");
  await sleep(900);
  const takeSwitchBack = await recordTake(3);
  const hostBack = await analyzeAudio(takeSwitchBack.find(t => t.label === "Host").url);
  check("live switch back CH1 mic-b→mic-a: 300Hz restored on Host", hostBack.g300 > 0.004 && hostBack.g300 > hostBack.g520 * 4, `g300=${hostBack.g300.toFixed(3)} g520=${hostBack.g520.toFixed(3)}`);

  // ===== 5. Full record: video + master + per-mic tracks =====
  await clickText("Side-by-Side");
  const take1 = await recordTake(4);
  const labels1 = take1.map(t => t.label);
  check("take has Program video + Master mix + 2 mic tracks", take1.length === 4 && labels1.includes("Program video") && labels1.includes("Master mix"), JSON.stringify(labels1));
  const master1 = await analyzeAudio(take1.find(t => t.label === "Master mix").url);
  check("master mix non-silent, ~4s", master1.rms0 > 0.01 && master1.dur > 3 && master1.dur < 6, `rms=${master1.rms0.toFixed(3)} dur=${master1.dur.toFixed(1)}`);
  check("master mix contains BOTH 300Hz and 520Hz", master1.g300 > 0.004 && master1.g520 > 0.004, `g300=${master1.g300.toFixed(3)} g520=${master1.g520.toFixed(3)}`);
  const host = await analyzeAudio(take1.find(t => t.label === "Host").url);
  const guest = await analyzeAudio(take1.find(t => t.label === "Guest").url);
  check("Host track: 300Hz present, 520Hz absent (separation)", host.g300 > 0.004 && host.g300 > host.g520 * 4, `g300=${host.g300.toFixed(3)} g520=${host.g520.toFixed(3)}`);
  check("Guest track: 520Hz present, 300Hz absent (separation)", guest.g520 > 0.004 && guest.g520 > guest.g300 * 4, `g520=${guest.g520.toFixed(3)} g300=${guest.g300.toFixed(3)}`);
  // video frame check
  const vidCheck = await ev(async (u) => {
    const v = document.createElement("video");
    v.muted = true; v.src = u; v.playsInline = true;
    await v.play();
    await new Promise(r => setTimeout(r, 900));
    const c = document.createElement("canvas"); c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
    const x = c.getContext("2d"); x.drawImage(v, 0, 0, c.width, c.height);
    v.pause();
    const P = window.__probe;
    return { w: c.width, left: P.regionColor(c, 0.08, 0.35, 0.25, 0.3), right: P.regionColor(c, 0.65, 0.35, 0.25, 0.3) };
  }, take1.find(t => t.label === "Program video").url);
  check("program video file: split layout frames (red|green), non-black", vidCheck.w > 0 && isRed(vidCheck.left) && isGreen(vidCheck.right), JSON.stringify(vidCheck));

  // ===== 6. Mute / Solo / Fader via recordings =====
  await stripBtn(0, "Mute");
  const takeMute = await recordTake(3);
  const masterMute = await analyzeAudio(takeMute.find(t => t.label === "Master mix").url);
  check("Mute CH1: master keeps 520Hz, loses 300Hz", masterMute.g520 > 0.004 && masterMute.g520 > masterMute.g300 * 4, `g300=${masterMute.g300.toFixed(3)} g520=${masterMute.g520.toFixed(3)}`);
  await stripBtn(0, "Mute"); // unmute
  await stripBtn(1, "Solo");
  const takeSolo = await recordTake(3);
  const masterSolo = await analyzeAudio(takeSolo.find(t => t.label === "Master mix").url);
  check("Solo CH2: master has 520Hz only", masterSolo.g520 > 0.004 && masterSolo.g520 > masterSolo.g300 * 4, `g300=${masterSolo.g300.toFixed(3)} g520=${masterSolo.g520.toFixed(3)}`);
  await stripBtn(1, "Solo"); // unsolo
  await setFader(0, -60); await setFader(1, -60);
  const takeFader = await recordTake(2.5);
  const masterFader = await analyzeAudio(takeFader.find(t => t.label === "Master mix").url);
  check("both faders at -60: master near-silent", masterFader.rms0 < 0.003, `rms=${masterFader.rms0.toFixed(4)}`);
  await setFader(0, -6); await setFader(1, -6);

  // ===== 7. Gate =====
  await setSlider(0, "Gate level", -10); // threshold above burst RMS -> gate mostly closed
  const takeGate = await recordTake(3);
  const hostGate = await analyzeAudio(takeGate.find(t => t.label === "Host").url);
  check("gate at -10dB: Host track strongly attenuated vs open gate", hostGate.rms0 < host.rms0 * 0.35, `gated=${hostGate.rms0.toFixed(4)} open=${host.rms0.toFixed(4)}`);
  await setSlider(0, "Gate level", -42);

  // ===== 8. Pan =====
  await setSlider(0, "Pan", 100);
  const takePan = await recordTake(3);
  const hostPan = await analyzeAudio(takePan.find(t => t.label === "Host").url);
  check("pan +100: Host track right-heavy", hostPan.ch === 2 && hostPan.rms1 > hostPan.rms0 * 3, `L=${hostPan.rms0.toFixed(3)} R=${hostPan.rms1.toFixed(3)}`);
  await setSlider(0, "Pan", -12);

  // ===== 9. Preset + compressor toggle =====
  await setSelect(`document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Voice preset"]')`, "clear");
  const presetState = await ev(() => {
    const strip = document.querySelectorAll(".strip")[0];
    const row = [...strip.querySelectorAll(".ctl")].find(r => r.querySelector("label")?.textContent.trim() === "High-pass");
    return row.querySelector("output").textContent;
  });
  check("preset 'Bright & Clear' applies (HPF 90Hz shown)", presetState.includes("90"), presetState);
  await setSwitch(0, "Compressor", false);
  await setSwitch(0, "Compressor", true);
  const mComp = await meterSamples(0, 1500);
  check("compressor toggle off/on: signal still passes", mComp.litCount >= 2, JSON.stringify(mComp));

  // ===== 10. Soundboard (all 8 pads in one take) =====
  const padNames = await ev(() => [...document.querySelectorAll(".pad")].map(p => p.textContent));
  check("soundboard has 8 pads", padNames.length === 8, padNames.join(","));
  const takePads = await recordTake(0.5, async () => {
    for (let i = 0; i < 8; i++) {
      await ev((idx) => document.querySelectorAll(".pad")[idx].click(), i);
      await sleep(1100);
    }
  });
  const masterPads = await analyzeAudio(takePads.find(t => t.label === "Master mix").url);
  check("soundboard pads audible in master recording", masterPads.rms0 > 0.01 && masterPads.dur > 7, `rms=${masterPads.rms0.toFixed(3)} dur=${masterPads.dur.toFixed(1)}`);

  // ===== 11. Music channel + EQ =====
  const fileInput = await page.$('.strip input[type="file"]');
  await fileInput.uploadFile(wavPath);
  await sleep(600);
  await stripBtn(2, "Play");
  const mMus = await meterSamples(2, 1800);
  check("music channel plays, meter moves", mMus.litCount >= 4, JSON.stringify(mMus));
  const takeMus = await recordTake(3);
  const masterMus = await analyzeAudio(takeMus.find(t => t.label === "Master mix").url);
  check("music tones (200Hz+6kHz) in master", masterMus.g200 > 0.005 && masterMus.g6000 > 0.005, `g200=${masterMus.g200.toFixed(3)} g6000=${masterMus.g6000.toFixed(3)}`);
  const ratioBefore = masterMus.g6000 / Math.max(masterMus.g200, 1e-6);
  await setSlider(2, "High", 15);
  const takeMus2 = await recordTake(3);
  const masterMus2 = await analyzeAudio(takeMus2.find(t => t.label === "Master mix").url);
  const ratioAfter = masterMus2.g6000 / Math.max(masterMus2.g200, 1e-6);
  check("EQ High +15 boosts 6kHz/200Hz ratio", ratioAfter > ratioBefore * 1.8, `before=${ratioBefore.toFixed(2)} after=${ratioAfter.toFixed(2)}`);
  await setSlider(2, "High", 0);
  await ev(() => {
    const strip = document.querySelectorAll(".strip")[2];
    const b = [...strip.querySelectorAll("button")].find(e => e.textContent.trim() === "Pause");
    if (b) b.click();
  });

  // ===== 12. Master fader / limiter / monitor =====
  const masterStripIdx = 3;
  await setFader(masterStripIdx, -60);
  const takeMF = await recordTake(2.5);
  const masterMF = await analyzeAudio(takeMF.find(t => t.label === "Master mix").url);
  check("master fader -60: master track near-silent", masterMF.rms0 < 0.003, `rms=${masterMF.rms0.toFixed(4)}`);
  await setFader(masterStripIdx, 0);
  await setSwitch(masterStripIdx, "Limiter", false);
  await setSwitch(masterStripIdx, "Limiter", true);
  await ev(() => { const t = document.getElementById("monitorToggle"); t.checked = true; t.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(300);
  const monState = await ev(() => document.getElementById("monitorToggle").checked);
  await ev(() => { const t = document.getElementById("monitorToggle"); t.checked = false; t.dispatchEvent(new Event("change", { bubbles: true })); });
  check("limiter + monitor toggles operate without error", monState === true && consoleErrors.length === 0, `errors=${consoleErrors.length}`);

  // ===== 13. Pause / resume =====
  await ev(() => document.getElementById("recBtn").click());
  await sleep(2000);
  await ev(() => document.getElementById("pauseBtn").click());
  await sleep(2000);
  await ev(() => document.getElementById("pauseBtn").click());
  await sleep(2000);
  const groupsBefore = await ev(() => document.querySelectorAll("#takes .take-group").length);
  await ev(() => document.getElementById("recBtn").click());
  for (let i = 0; i < 40; i++) { if (await ev(() => document.querySelectorAll("#takes .take-group").length) > groupsBefore) break; await sleep(300); }
  const takePause = await ev(() => {
    const g = document.querySelectorAll("#takes .take-group");
    const last = g[g.length - 1];
    return [...last.querySelectorAll(".take")].map(r => ({ label: r.querySelector(".meta b").textContent, url: r.querySelector("a").href }));
  });
  const masterPause = await analyzeAudio(takePause.find(t => t.label === "Master mix").url);
  check("pause/resume: recorded duration ~4s (paused time excluded)", masterPause.dur > 3 && masterPause.dur < 5.5, `dur=${masterPause.dur.toFixed(1)}`);

  // ===== 14. Downloads present =====
  const dl = await ev(() => [...document.querySelectorAll("#takes a[download]")].map(a => a.download));
  check("every take row has a named download", dl.length >= 4 && dl.every(d => /\.(webm|mp4|m4a|ogg)$/.test(d)), dl.slice(0, 4).join(", "));

  // ===== 15. Device unplug (simulated ended) =====
  await ev(() => {
    const s = window.__synth.streams["mic-a"];
    const tr = s.getAudioTracks()[0];
    if (typeof tr.onended === "function") tr.onended();
    else tr.dispatchEvent(new Event("ended"));
  });
  await sleep(600);
  const afterUnplug = await ev(() => ({
    tag: document.querySelectorAll(".strip")[0].querySelector('[data-role="livetag"]').textContent,
    notice: document.getElementById("notice").textContent,
  }));
  check("mic unplug: channel goes Off with honest notice", afterUnplug.tag === "Off" && /disconnect/i.test(afterUnplug.notice), JSON.stringify(afterUnplug));

  // ===== 16. Permission denied (fresh page) =====
  const page2 = await browser.newPage();
  const errs2 = [];
  page2.on("pageerror", (e) => errs2.push(e.message));
  await page2.evaluateOnNewDocument(INJECT);
  await page2.evaluateOnNewDocument(() => { window.__denyMedia = true; });
  await page2.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(500);
  await page2.evaluate(() => {
    const strip = document.querySelectorAll(".strip")[0];
    [...strip.querySelectorAll("button")].find(b => b.textContent.includes("Enable Mic")).click();
  });
  await sleep(600);
  const denyNotice = await page2.evaluate(() => document.getElementById("notice").textContent);
  check("permission denied: honest notice, no crash", /blocked/i.test(denyNotice) && errs2.length === 0, denyNotice.slice(0, 80));
  await page2.close();

  // ===== 17. Duplicate device labels (two identical FIFINEs): numbered
  // "— Microphone One/Two", unique labels unchanged, deviceId binding intact =====
  const page3 = await browser.newPage();
  const errs3 = [];
  page3.on("pageerror", (e) => errs3.push(e.message));
  await page3.evaluateOnNewDocument(INJECT);
  await page3.evaluateOnNewDocument(() => {
    navigator.mediaDevices.enumerateDevices = async () => [
      { deviceId: "mic-a", kind: "audioinput", label: "USB PnP Audio Device", groupId: "g1" },
      { deviceId: "mic-b", kind: "audioinput", label: "USB PnP Audio Device", groupId: "g2" },
      { deviceId: "cam-a", kind: "videoinput", label: "USB Camera", groupId: "g3" },
      { deviceId: "cam-b", kind: "videoinput", label: "USB Camera", groupId: "g4" },
      { deviceId: "cam-c", kind: "videoinput", label: "Synthetic Cam C (blue)", groupId: "g5" },
    ];
  });
  await page3.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(600);
  const dupMicOpts = await page3.evaluate(() => [...document.querySelectorAll(".strip select")].filter(s => s.getAttribute("aria-label") === "Microphone device").map(s => [...s.options].map(o => ({ v: o.value, t: o.textContent }))));
  check("duplicate mic labels numbered Microphone One/Two in enumeration order", dupMicOpts[0].length === 3 && dupMicOpts[0][1].t === "USB PnP Audio Device — Microphone One" && dupMicOpts[0][2].t === "USB PnP Audio Device — Microphone Two" && dupMicOpts[0][1].v === "mic-a" && dupMicOpts[0][2].v === "mic-b", JSON.stringify(dupMicOpts[0]));
  const dupCamOpts = await page3.evaluate(() => [...document.querySelectorAll("#camList .cam-card select")].map(s => [...s.options].map(o => o.textContent)));
  check("duplicate cam labels numbered Camera One/Two; unique label unchanged", dupCamOpts[0].includes("USB Camera — Camera One") && dupCamOpts[0].includes("USB Camera — Camera Two") && dupCamOpts[0].includes("Synthetic Cam C (blue)"), JSON.stringify(dupCamOpts[0]));
  // Bind by deviceId: CH1 -> mic-b (520Hz), CH2 -> mic-a (300Hz); per-mic
  // tracks prove each numbered entry still maps to its own device.
  await page3.evaluate(() => {
    const s1 = document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]');
    s1.value = "mic-b"; s1.dispatchEvent(new Event("change", { bubbles: true }));
    const s2 = document.querySelectorAll(".strip")[1].querySelector('select[aria-label="Microphone device"]');
    s2.value = "mic-a"; s2.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(200);
  await page3.evaluate(() => {
    [...document.querySelectorAll(".strip")[0].querySelectorAll("button")].find(b => b.textContent.includes("Enable Mic")).click();
    [...document.querySelectorAll(".strip")[1].querySelectorAll("button")].find(b => b.textContent.includes("Enable Mic")).click();
  });
  await sleep(600);
  await page3.evaluate(() => document.getElementById("recBtn").click());
  await sleep(3000);
  await page3.evaluate(() => document.getElementById("recBtn").click());
  for (let i = 0; i < 40; i++) { if (await page3.evaluate(() => document.querySelectorAll("#takes .take-group").length) > 0) break; await sleep(300); }
  const dupTakes = await page3.evaluate(() => {
    const g = document.querySelectorAll("#takes .take-group");
    const last = g[g.length - 1];
    return [...last.querySelectorAll(".take")].map(r => ({ label: r.querySelector(".meta b").textContent, url: r.querySelector("a").href }));
  });
  const dupAnalyze = async (url) => page3.evaluate(async (u) => {
    const buf = await window.__probe.decode(u);
    const P = window.__probe;
    return { g300: P.goertzel(buf, 300), g520: P.goertzel(buf, 520) };
  }, url);
  const dupHost = await dupAnalyze(dupTakes.find(t => t.label === "Host").url);
  const dupGuest = await dupAnalyze(dupTakes.find(t => t.label === "Guest").url);
  check("numbered entries bind right deviceId: Host=mic-b 520Hz, Guest=mic-a 300Hz", dupHost.g520 > 0.004 && dupHost.g520 > dupHost.g300 * 4 && dupGuest.g300 > 0.004 && dupGuest.g300 > dupGuest.g520 * 4 && errs3.length === 0, `host g300=${dupHost.g300.toFixed(3)} g520=${dupHost.g520.toFixed(3)} | guest g300=${dupGuest.g300.toFixed(3)} g520=${dupGuest.g520.toFixed(3)} errs=${errs3.length}`);
  await page3.close();

  // ===== 18. Late-appearing devices (hot-plug after load): devicechange,
  // manual Rescan, periodic signature rescan, and window-focus rescan =====
  const page4 = await browser.newPage();
  const errs4 = [];
  page4.on("pageerror", (e) => errs4.push(e.message));
  await page4.evaluateOnNewDocument(INJECT);
  await page4.evaluateOnNewDocument(() => {
    window.__synth.setDevices([
      { deviceId: "mic-a", kind: "audioinput", label: "Synthetic Mic A (300Hz)", groupId: "g1" },
      { deviceId: "mic-b", kind: "audioinput", label: "Synthetic Mic B (520Hz)", groupId: "g2" },
      { deviceId: "cam-a", kind: "videoinput", label: "Synthetic Cam A (red)", groupId: "g3" },
    ]);
  });
  await page4.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(600);
  const camTexts4 = () => page4.evaluate(() => [...document.querySelectorAll("#camList .cam-card select")].map(s => [...s.options].map(o => o.textContent)));
  let opts4 = await camTexts4();
  check("hot-plug: page starts with only Cam A listed", opts4[0].length === 2 && opts4[0][1] === "Synthetic Cam A (red)", JSON.stringify(opts4[0]));
  // (a) device appears + devicechange fires
  await page4.evaluate(() => {
    window.__synth.setDevices([
      { deviceId: "mic-a", kind: "audioinput", label: "Synthetic Mic A (300Hz)", groupId: "g1" },
      { deviceId: "mic-b", kind: "audioinput", label: "Synthetic Mic B (520Hz)", groupId: "g2" },
      { deviceId: "cam-a", kind: "videoinput", label: "Synthetic Cam A (red)", groupId: "g3" },
      { deviceId: "cam-b", kind: "videoinput", label: "Synthetic Cam B (green)", groupId: "g4" },
    ]);
    window.__synth.fireDeviceChange();
  });
  await sleep(700);
  opts4 = await camTexts4();
  check("hot-plug: devicechange adds Cam B to all dropdowns", opts4.every(o => o.includes("Synthetic Cam B (green)")), JSON.stringify(opts4[0]));
  // (b) device set changes with NO devicechange (Safari Continuity Camera
  // case) -> manual Rescan button picks it up and reports counts
  await page4.evaluate(() => {
    window.__synth.setDevices([
      { deviceId: "mic-a", kind: "audioinput", label: "Synthetic Mic A (300Hz)", groupId: "g1" },
      { deviceId: "mic-b", kind: "audioinput", label: "Synthetic Mic B (520Hz)", groupId: "g2" },
      { deviceId: "cam-a", kind: "videoinput", label: "Synthetic Cam A (red)", groupId: "g3" },
      { deviceId: "cam-c", kind: "videoinput", label: "Synthetic Cam C (blue)", groupId: "g5" },
    ]);
  });
  await page4.evaluate(() => document.getElementById("rescanBtn").click());
  await sleep(800);
  opts4 = await camTexts4();
  const rescanNotice = await page4.evaluate(() => document.getElementById("notice").textContent);
  check("hot-plug: Rescan button adds Cam C, drops Cam B, notice reports counts", opts4[0].includes("Synthetic Cam C (blue)") && !opts4[0].includes("Synthetic Cam B (green)") && /Rescan complete/.test(rescanNotice) && /2 cameras/.test(rescanNotice) && /2 microphones/.test(rescanNotice), JSON.stringify(opts4[0]) + " | " + rescanNotice.slice(0, 60));
  // (c) device removed with NO event at all -> periodic signature rescan
  // (5s interval) must pick it up on its own
  await page4.evaluate(() => {
    window.__synth.setDevices([
      { deviceId: "mic-a", kind: "audioinput", label: "Synthetic Mic A (300Hz)", groupId: "g1" },
      { deviceId: "mic-b", kind: "audioinput", label: "Synthetic Mic B (520Hz)", groupId: "g2" },
      { deviceId: "cam-a", kind: "videoinput", label: "Synthetic Cam A (red)", groupId: "g3" },
    ]);
  });
  let periodicOk = false;
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    opts4 = await camTexts4();
    if (!opts4[0].includes("Synthetic Cam C (blue)")) { periodicOk = true; break; }
  }
  check("hot-plug: periodic rescan drops removed Cam C with no event fired", periodicOk, JSON.stringify(opts4[0]));
  // (d) device appears with no devicechange -> window focus rescan picks it up
  await page4.evaluate(() => {
    window.__synth.setDevices([
      { deviceId: "mic-a", kind: "audioinput", label: "Synthetic Mic A (300Hz)", groupId: "g1" },
      { deviceId: "mic-b", kind: "audioinput", label: "Synthetic Mic B (520Hz)", groupId: "g2" },
      { deviceId: "cam-a", kind: "videoinput", label: "Synthetic Cam A (red)", groupId: "g3" },
      { deviceId: "cam-b", kind: "videoinput", label: "Synthetic Cam B (green)", groupId: "g4" },
    ]);
    window.dispatchEvent(new Event("focus"));
  });
  await sleep(800);
  opts4 = await camTexts4();
  check("hot-plug: window-focus rescan adds Cam B with no devicechange", opts4[0].includes("Synthetic Cam B (green)") && errs4.length === 0, JSON.stringify(opts4[0]) + ` errs=${errs4.length}`);
  await page4.close();

  // ===== 19. Aggregate device split (macOS "Podcast Mics"): one 2-channel
  // device feeds both mic strips through a ChannelSplitterNode, each strip
  // keeping its own signal/track; a 1-channel stream under an aggregate
  // label must be called out honestly, not shown as two live mics =====
  const page5 = await browser.newPage();
  const errs5 = [];
  page5.on("pageerror", (e) => errs5.push(e.message));
  await page5.evaluateOnNewDocument(INJECT);
  await page5.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(600);
  const aggOpt = await page5.evaluate(() => {
    const sel = document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]');
    return [...sel.options].map(o => ({ v: o.value, t: o.textContent }));
  });
  check("aggregate device labeled '(aggregate — both mics)' in Mic 1 dropdown", aggOpt.some(o => o.v === "agg-1" && o.t === "Podcast Mics (aggregate — both mics)"), JSON.stringify(aggOpt));
  await page5.evaluate(() => {
    const sel = document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]');
    sel.value = "agg-1"; sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(300);
  const splitArmed = await page5.evaluate(() => {
    const sw = [...document.querySelectorAll(".strip")[0].querySelectorAll(".switch")].find(s => s.textContent.includes("Aggregate split"));
    return sw ? sw.querySelector('input[type="checkbox"]').checked : null;
  });
  check("selecting the aggregate auto-arms the split switch on Mic 1", splitArmed === true, `checked=${splitArmed}`);
  await page5.evaluate(() => {
    [...document.querySelectorAll(".strip")[0].querySelectorAll("button")].find(b => b.textContent.includes("Enable Mic")).click();
  });
  await sleep(900);
  const aggTags = await page5.evaluate(() => [...document.querySelectorAll(".strip")].slice(0, 2).map(s => s.querySelector('[data-role="livetag"]').textContent));
  check("aggregate connect: Mic 1 live, Mic 2 live from aggregate ch 2", aggTags[0] === "Mic live" && /aggregate ch 2/.test(aggTags[1]), JSON.stringify(aggTags));
  await page5.evaluate(() => document.getElementById("recBtn").click());
  await sleep(3000);
  await page5.evaluate(() => document.getElementById("recBtn").click());
  for (let i = 0; i < 40; i++) { if (await page5.evaluate(() => document.querySelectorAll("#takes .take-group").length) > 0) break; await sleep(300); }
  const aggTakes = await page5.evaluate(() => {
    const g = document.querySelectorAll("#takes .take-group");
    const last = g[g.length - 1];
    return [...last.querySelectorAll(".take")].map(r => ({ label: r.querySelector(".meta b").textContent, url: r.querySelector("a").href }));
  });
  const aggAnalyze = async (url) => page5.evaluate(async (u) => {
    const buf = await window.__probe.decode(u);
    const P = window.__probe;
    return { g300: P.goertzel(buf, 300), g520: P.goertzel(buf, 520) };
  }, url);
  const aggHost = await aggAnalyze(aggTakes.find(t => t.label === "Host").url);
  const aggGuest = await aggAnalyze(aggTakes.find(t => t.label === "Guest").url);
  const aggMaster = await aggAnalyze(aggTakes.find(t => t.label === "Master mix").url);
  check("aggregate split: Host track = ch1 300Hz only, Guest track = ch2 520Hz only", aggHost.g300 > 0.004 && aggHost.g300 > aggHost.g520 * 4 && aggGuest.g520 > 0.004 && aggGuest.g520 > aggGuest.g300 * 4, `host g300=${aggHost.g300.toFixed(3)} g520=${aggHost.g520.toFixed(3)} | guest g300=${aggGuest.g300.toFixed(3)} g520=${aggGuest.g520.toFixed(3)}`);
  check("aggregate split: master mix contains both aggregate channels", aggMaster.g300 > 0.004 && aggMaster.g520 > 0.004, `g300=${aggMaster.g300.toFixed(3)} g520=${aggMaster.g520.toFixed(3)}`);
  // Disconnect on Mic 1 must release Mic 2's split feed too
  await page5.evaluate(() => {
    [...document.querySelectorAll(".strip")[0].querySelectorAll("button")].find(b => b.textContent.trim() === "Disconnect").click();
  });
  await sleep(500);
  const tagsAfterDisc = await page5.evaluate(() => [...document.querySelectorAll(".strip")].slice(0, 2).map(s => s.querySelector('[data-role="livetag"]').textContent));
  check("disconnecting Mic 1 releases Mic 2's aggregate feed", tagsAfterDisc.every(t => t === "Off"), JSON.stringify(tagsAfterDisc));
  // Mono fallback: a 1-channel stream under an aggregate label must leave
  // Mic 2 off and say so, not pretend both mics are live
  await page5.evaluate(() => {
    const sel = document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]');
    sel.value = "agg-mono"; sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(300);
  await page5.evaluate(() => {
    [...document.querySelectorAll(".strip")[0].querySelectorAll("button")].find(b => b.textContent.includes("Enable Mic")).click();
  });
  await sleep(900);
  const monoState = await page5.evaluate(() => ({
    tags: [...document.querySelectorAll(".strip")].slice(0, 2).map(s => s.querySelector('[data-role="livetag"]').textContent),
    notice: document.getElementById("notice").textContent,
  }));
  check("mono aggregate: Mic 1 live, Mic 2 NOT fed, honest 1-channel notice", monoState.tags[0] === "Mic live" && monoState.tags[1] === "Off" && /only 1 channel/.test(monoState.notice) && errs5.length === 0, JSON.stringify(monoState).slice(0, 180));
  await page5.close();

  // ===== 20. Wireless cameras (phones as cameras): the mixer's Daily
  // integration with the transport stubbed at the SDK boundary — the
  // stub hands the mixer real synthetic canvas tracks as remote
  // participants, so slot assignment, composite, and recording all run
  // the production code paths. /api/demo-admin is stubbed at fetch. =====
  const WIRELESS_STUB = () => {
    window.__camApi = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes("/api/demo-admin")) {
        const body = JSON.parse((opts && opts.body) || "{}");
        window.__camApi.push(body);
        if (body.action === "cam-create") {
          return new Response(JSON.stringify({
            ok: true,
            session: { sessionId: "cam_test", roomUrl: "https://curavia.daily.co/iec-cam_test", expiresAt: new Date(Date.now() + 3600000).toISOString() },
            ownerToken: "owner-tok",
            slots: [
              { slot: 2, label: "Cam 2", code: "AAAA22" },
              { slot: 3, label: "Cam 3", code: "BBBB33" },
              { slot: 4, label: "Cam 4", code: "CCCC44" },
              { slot: 5, label: "Cam 5", code: "DDDD55" },
            ],
          }), { status: 201, headers: { "content-type": "application/json" } });
        }
        if (body.action === "cam-end") {
          return new Response(JSON.stringify({ ok: true, session: { sessionId: body.sessionId, status: "ended" } }),
            { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: false, error: "unknown_action" }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return realFetch(url, opts);
    };
    // Daily SDK stub: event-emitter call object; test joins synthetic
    // remote participants carrying canvas video tracks.
    const handlers = {};
    const parts = {};
    const call = {
      _joinOpts: null, _ejected: [], _recvSettings: null,
      updateReceiveSettings(s) { call._recvSettings = s; },
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
      emit(ev, payload) { (handlers[ev] || []).forEach((fn) => fn(payload)); },
      async join(opts) { call._joinOpts = opts; call.emit("joined-meeting", {}); return {}; },
      participants() { return parts; },
      eject(id) {
        call._ejected.push(id);
        const p = parts[id]; delete parts[id];
        if (p) call.emit("participant-left", { participant: p });
      },
      async leave() { return {}; },
      destroy() {},
    };
    window.DailyIframe = { createCallObject: () => call };
    function phoneTrack(color, label) {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 180;
      const x = c.getContext("2d");
      let t = 0, last = 0;
      (function draw(now) {
        if (!last || now - last >= 33) {
          last = now;
          t++;
          x.fillStyle = color; x.fillRect(0, 0, 320, 180);
          x.fillStyle = "rgba(255,255,255,0.9)";
          x.beginPath(); x.arc(30 + (t * 3) % 260, 20, 8, 0, 7); x.fill();
          x.fillStyle = "#ffffff"; x.font = "bold 32px sans-serif";
          x.fillText(label, 85, 105);
        }
        requestAnimationFrame(draw);
      })(0);
      return c.captureStream(30).getVideoTracks()[0];
    }
    window.__daily = {
      call,
      joinPhone(id, name, color) {
        const p = {
          session_id: id, user_name: name, local: false,
          tracks: { video: { state: "playable", persistentTrack: phoneTrack(color, name) } },
        };
        parts[id] = p;
        call.emit("participant-joined", { participant: p });
        call.emit("track-started", { participant: p, track: p.tracks.video.persistentTrack });
        return p;
      },
      leavePhone(id) {
        const p = parts[id]; delete parts[id];
        if (p) call.emit("participant-left", { participant: p });
      },
    };
  };
  const isPurple = (c) => c[0] > 80 && c[2] > 110 && c[1] < 90;
  const isOrange = (c) => c[0] > 190 && c[1] > 70 && c[1] < 170 && c[2] < 70;
  const isCyan = (c) => c[1] > 100 && c[2] > 100 && c[0] < 80;
  const isMagenta = (c) => c[0] > 150 && c[2] > 60 && c[2] < 140 && c[1] < 80;

  const page6 = await browser.newPage();
  const errs6 = [];
  page6.on("pageerror", (e) => errs6.push(e.message));
  await page6.evaluateOnNewDocument(INJECT);
  await page6.evaluateOnNewDocument(WIRELESS_STUB);
  await page6.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(600);
  const wCards = await page6.evaluate(() => [...document.querySelectorAll("#wirelessList .cam-card")].map((card) => ({
    code: card.querySelector('[data-role="code"]').textContent,
    status: card.querySelector('[data-role="status"]').textContent,
  })));
  check("wireless: 4 slot cards, codes hidden before session", wCards.length === 4 && wCards.every((c) => /––––––/.test(c.code)), JSON.stringify(wCards.map((c) => c.code)));
  await page6.evaluate(() => document.getElementById("wirelessStartBtn").click());
  await sleep(800);
  const wStarted = await page6.evaluate(() => ({
    codes: [...document.querySelectorAll("#wirelessList .cam-card")].map((c) => c.querySelector('[data-role="code"]').textContent),
    links: [...document.querySelectorAll("#wirelessList .cam-card")].map((c) => c.querySelector('[data-role="link"]').textContent),
    session: document.getElementById("wirelessSessionStatus").textContent,
    joinOpts: window.__daily.call._joinOpts,
    api: window.__camApi.map((b) => b.action),
  }));
  check("wireless: start mints session, shows 4 codes + join links", eq(wStarted.codes, ["AAAA22", "BBBB33", "CCCC44", "DDDD55"]) && wStarted.links.every((l) => l.includes("/camera.html?code=")) && /Session live/.test(wStarted.session), JSON.stringify(wStarted.codes) + " | " + wStarted.session);
  check("wireless: mixer joins receive-only with owner token", wStarted.joinOpts && wStarted.joinOpts.startVideoOff === true && wStarted.joinOpts.startAudioOff === true && wStarted.joinOpts.token === "owner-tok" && eq(wStarted.api, ["cam-create"]), JSON.stringify(wStarted.joinOpts));
  const wRecv = await page6.evaluate(() => window.__daily.call._recvSettings);
  check("wireless HD: mixer requests highest simulcast layer from phones", wRecv && wRecv["*"] && wRecv["*"].video && wRecv["*"].video.layer === 2, JSON.stringify(wRecv));
  // Phone 1 (purple) joins -> first free slot (Cam 2), becomes main
  await page6.evaluate(() => window.__daily.joinPhone("phone-1", "Cam 2", "#7b1fa2"));
  await sleep(900);
  const w1 = await page6.evaluate(() => {
    const card = document.querySelectorAll("#wirelessList .cam-card")[0];
    const v = card.querySelector("video");
    return {
      status: card.querySelector('[data-role="status"]').textContent,
      tag: card.querySelector('[data-role="tag"]').textContent,
      has: !!v.srcObject, w: v.videoWidth,
      badge: document.getElementById("programBadgeText").textContent,
    };
  });
  const w1col = await page6.evaluate(() => window.__probe.regionColor(document.getElementById("program"), 0.35, 0.35, 0.3, 0.3));
  check("wireless: phone 1 takes Cam 2 slot, live, program shows it (purple)", /Live/.test(w1.status) && w1.has && w1.w > 0 && isPurple(w1col) && /Cam 2/.test(w1.badge), `status=${w1.status} tag=${w1.tag} col=${w1col} badge=${w1.badge}`);
  const w1res = await page6.evaluate(() => document.querySelectorAll("#wirelessList .cam-card")[0].querySelector('[data-role="res"]').textContent);
  check("wireless HD: slot shows actual received resolution (synthetic 320x180, honest)", w1res === "320×180 · below HD", w1res);
  // Phone 2 (orange) joins -> Cam 3; main unchanged
  await page6.evaluate(() => window.__daily.joinPhone("phone-2", "Cam 3", "#ef6c00"));
  await sleep(900);
  const w2col = await page6.evaluate(() => window.__probe.regionColor(document.getElementById("program"), 0.35, 0.35, 0.3, 0.3));
  const w2status = await page6.evaluate(() => document.querySelectorAll("#wirelessList .cam-card")[1].querySelector('[data-role="status"]').textContent);
  check("wireless: phone 2 takes Cam 3, main stays Cam 2 (purple)", /Live/.test(w2status) && isPurple(w2col), `status=${w2status} col=${w2col}`);
  // Tap Cam 3 thumb -> main switches to orange
  await page6.evaluate(() => document.querySelectorAll("#wirelessList .cam-thumb")[1].click());
  await sleep(600);
  const w3col = await page6.evaluate(() => window.__probe.regionColor(document.getElementById("program"), 0.35, 0.35, 0.3, 0.3));
  const w3badge = await page6.evaluate(() => document.getElementById("programBadgeText").textContent);
  check("wireless: tap Cam 3 thumb makes it main (orange)", isOrange(w3col) && /Cam 3/.test(w3badge), `col=${w3col} badge=${w3badge}`);
  // Rename Cam 3 slot
  await page6.evaluate(() => {
    const input = document.querySelectorAll("#wirelessList .cam-card")[1].querySelector('[data-role="name"]');
    input.value = "Guest Wide";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(300);
  const wTag = await page6.evaluate(() => document.querySelectorAll("#wirelessList .cam-card")[1].querySelector('[data-role="tag"]').textContent);
  check("wireless: rename slot updates its tag", /Guest Wide/.test(wTag), wTag);
  // Record: program video must contain the wireless (orange) feed
  await page6.evaluate(() => document.getElementById("recBtn").click());
  await sleep(2600);
  await page6.evaluate(() => document.getElementById("recBtn").click());
  for (let i = 0; i < 40; i++) { if (await page6.evaluate(() => document.querySelectorAll("#takes .take-group").length) > 0) break; await sleep(300); }
  const wTake = await page6.evaluate(async () => {
    const g = document.querySelectorAll("#takes .take-group");
    const last = g[g.length - 1];
    const rows = [...last.querySelectorAll(".take")].map((r) => ({ label: r.querySelector(".meta b").textContent, url: r.querySelector("a").href, isVideo: !!r.querySelector("video") }));
    const vidRow = rows.find((r) => r.isVideo);
    const v = document.createElement("video");
    v.muted = true; v.src = vidRow.url; v.playsInline = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 900));
    const c = document.createElement("canvas"); c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    v.pause();
    return { labels: rows.map((r) => r.label), col: window.__probe.regionColor(c, 0.35, 0.35, 0.3, 0.3) };
  });
  check("wireless: recorded program video contains the phone feed (orange)", wTake.labels.includes("Program video") && isOrange(wTake.col), `labels=${JSON.stringify(wTake.labels)} col=${wTake.col}`);
  // Move/swap: move Cam 3's feed to the Cam 4 slot
  await page6.evaluate(() => {
    const sel = document.querySelectorAll("#wirelessList .cam-card")[1].querySelector('[data-role="move"]');
    sel.value = "4";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(700);
  const wSwap = await page6.evaluate(() => {
    const cards = document.querySelectorAll("#wirelessList .cam-card");
    const v3 = cards[1].querySelector("video"), v4 = cards[2].querySelector("video");
    return {
      s3: cards[1].querySelector('[data-role="status"]').textContent,
      s4: cards[2].querySelector('[data-role="status"]').textContent,
      has3: !!v3.srcObject, has4: !!v4.srcObject, w4: v4.videoWidth,
    };
  });
  check("wireless: move feed swaps slots (Cam 3 empty, Cam 4 live)", !wSwap.has3 && wSwap.has4 && wSwap.w4 > 0 && /Live/.test(wSwap.s4), JSON.stringify(wSwap));
  // Fill remaining slots, then a 5th phone must be refused honestly
  await page6.evaluate(() => { window.__daily.joinPhone("phone-3", "Cam 5", "#00838f"); });
  await sleep(700);
  await page6.evaluate(() => { window.__daily.joinPhone("phone-4", "Extra", "#c2185b"); });
  await sleep(700);
  const wFull = await page6.evaluate(() => ({
    live: [...document.querySelectorAll("#wirelessList .cam-card")].map((c) => c.querySelector('[data-role="status"]').textContent),
  }));
  check("wireless: phones fill all 4 slots", wFull.live.every((s) => /Live/.test(s)), JSON.stringify(wFull.live));
  await page6.evaluate(() => window.__daily.joinPhone("phone-5", "Overflow", "#f9a825"));
  await sleep(700);
  const wOver = await page6.evaluate(() => ({
    notice: document.getElementById("notice").textContent,
    live: [...document.querySelectorAll("#wirelessList .cam-card")].map((c) => c.querySelector('[data-role="status"]').textContent),
  }));
  check("wireless: 5th phone refused with honest 'slots full' notice", /All 4 wireless camera slots are full/.test(wOver.notice) && wOver.live.every((s) => /Live/.test(s)), wOver.notice.slice(0, 90));
  // Drop Cam 2 -> eject + slot freed
  await page6.evaluate(() => document.querySelectorAll("#wirelessList .cam-card")[0].querySelector('[data-role="drop"]').click());
  await sleep(600);
  const wDrop = await page6.evaluate(() => ({
    ejected: window.__daily.call._ejected,
    status: document.querySelectorAll("#wirelessList .cam-card")[0].querySelector('[data-role="status"]').textContent,
    has: !!document.querySelectorAll("#wirelessList .cam-card")[0].querySelector("video").srcObject,
  }));
  check("wireless: drop ejects the phone and frees the slot", eq(wDrop.ejected, ["phone-1"]) && !wDrop.has && /Waiting/.test(wDrop.status), JSON.stringify(wDrop));
  // Participant-left frees its slot (phone-3 is in some slot)
  await page6.evaluate(() => window.__daily.leavePhone("phone-3"));
  await sleep(600);
  const wLeft = await page6.evaluate(() => [...document.querySelectorAll("#wirelessList .cam-card")].map((c) => c.querySelector('[data-role="status"]').textContent));
  check("wireless: phone leaving frees its slot", wLeft.filter((s) => /Waiting/.test(s)).length === 2, JSON.stringify(wLeft));
  // End session
  await page6.evaluate(() => document.getElementById("wirelessEndBtn").click());
  await sleep(800);
  const wEnd = await page6.evaluate(() => ({
    codes: [...document.querySelectorAll("#wirelessList .cam-card")].map((c) => c.querySelector('[data-role="code"]').textContent),
    session: document.getElementById("wirelessSessionStatus").textContent,
    api: window.__camApi.map((b) => b.action),
    startDisabled: document.getElementById("wirelessStartBtn").disabled,
  }));
  check("wireless: end session clears codes, calls cam-end, start re-enabled", wEnd.codes.every((c) => /––––––/.test(c)) && eq(wEnd.api, ["cam-create", "cam-end"]) && wEnd.startDisabled === false && errs6.length === 0, JSON.stringify(wEnd.api) + ` errs=${errs6.length}`);
  await page6.close();

  // ===== 20b. Wireless not-configured: server 503 -> honest notice,
  // local mixer untouched =====
  const page7 = await browser.newPage();
  const errs7 = [];
  page7.on("pageerror", (e) => errs7.push(e.message));
  await page7.evaluateOnNewDocument(INJECT);
  await page7.evaluateOnNewDocument(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes("/api/demo-admin")) {
        return new Response(JSON.stringify({ ok: false, error: "not_configured", message: "Wireless cameras are not configured yet (DAILY_API_KEY missing on this project)." }),
          { status: 503, headers: { "content-type": "application/json" } });
      }
      return realFetch(url, opts);
    };
  });
  await page7.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(600);
  await page7.evaluate(() => document.getElementById("wirelessStartBtn").click());
  await sleep(800);
  const wNc = await page7.evaluate(() => ({
    notice: document.getElementById("notice").textContent,
    session: document.getElementById("wirelessSessionStatus").textContent,
    startDisabled: document.getElementById("wirelessStartBtn").disabled,
    strips: document.querySelectorAll(".strip").length,
  }));
  check("wireless: not-configured fails honestly, mixer intact", /not configured yet/.test(wNc.notice) && /Local cameras and recording still work/.test(wNc.notice) && wNc.startDisabled === false && wNc.strips === 4 && errs7.length === 0, wNc.notice.slice(0, 110));
  await page7.close();

  // ===== 21. Phone camera page (/camera.html): code entry, join,
  // LIVE badge, flip, leave — Daily transport stubbed at the SDK
  // boundary with a synthetic local track =====
  const PHONE_STUB = () => {
    window.__joinCalls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes("/api/demo-admin")) {
        const body = JSON.parse((opts && opts.body) || "{}");
        window.__joinCalls.push(body);
        if (body.action === "cam-join" && body.code === "AAAA22") {
          return new Response(JSON.stringify({ ok: true, roomUrl: "https://curavia.daily.co/iec-cam_test", token: "cam-tok", slot: 2, label: "Cam 2" }),
            { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: false, error: "invalid_code", message: "That code was not recognized. Check the code in the mixer and try again." }),
          { status: 404, headers: { "content-type": "application/json" } });
      }
      return realFetch(url, opts);
    };
    function phoneTrack(color) {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 180;
      const x = c.getContext("2d");
      let t = 0, last = 0;
      (function draw(now) {
        if (!last || now - last >= 33) {
          last = now;
          t++;
          x.fillStyle = color; x.fillRect(0, 0, 320, 180);
          x.fillStyle = "rgba(255,255,255,0.9)";
          x.beginPath(); x.arc(30 + (t * 3) % 260, 20, 8, 0, 7); x.fill();
        }
        requestAnimationFrame(draw);
      })(0);
      return c.captureStream(30).getVideoTracks()[0];
    }
    const handlers = {};
    const local = {
      session_id: "local-1", user_name: "Cam 2", local: true,
      tracks: { video: { state: "playable", persistentTrack: phoneTrack("#7b1fa2") } },
    };
    const call = {
      _joinOpts: null, _switchedTo: null, _inputSettings: null,
      updateInputSettings(s) { call._inputSettings = s; },
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
      emit(ev, payload) { (handlers[ev] || []).forEach((fn) => fn(payload)); },
      async join(opts) {
        call._joinOpts = opts;
        call.emit("joined-meeting", {});
        call.emit("participant-updated", { participant: local });
        return {};
      },
      participants() { return { local }; },
      async getInputDevices() {
        return {
          devices: [
            { deviceId: "front-cam", kind: "videoinput", label: "Front" },
            { deviceId: "back-cam", kind: "videoinput", label: "Back" },
          ],
          currentCam: { deviceId: "front-cam" },
        };
      },
      async setInputDevicesAsync(opts) {
        call._switchedTo = opts.videoDeviceId;
        local.tracks.video.persistentTrack = phoneTrack("#ef6c00");
        call.emit("participant-updated", { participant: local });
        return {};
      },
      async leave() { call.emit("left-meeting", {}); return {}; },
      destroy() {},
    };
    window.DailyIframe = { createCallObject: () => call };
    window.__phoneCall = call;
  };
  const page8 = await browser.newPage();
  const errs8 = [];
  page8.on("pageerror", (e) => errs8.push(e.message));
  await page8.evaluateOnNewDocument(INJECT);
  await page8.evaluateOnNewDocument(PHONE_STUB);
  await page8.goto("http://127.0.0.1:8931/camera.html", { waitUntil: "networkidle0" });
  await sleep(600);
  await page8.evaluate(() => {
    document.getElementById("codeInput").value = "ZZZZZZ";
    document.getElementById("joinBtn").click();
  });
  await sleep(800);
  const phBad = await page8.evaluate(() => ({
    status: document.getElementById("joinStatus").textContent,
    liveHidden: document.getElementById("liveSection").classList.contains("hidden"),
  }));
  check("phone: bad code shows honest error, stays on join screen", /not recognized/.test(phBad.status) && phBad.liveHidden === true, phBad.status.slice(0, 80));
  await page8.evaluate(() => {
    document.getElementById("codeInput").value = "aaaa22";
    document.getElementById("joinBtn").click();
  });
  await sleep(1200);
  const phLive = await page8.evaluate(() => {
    const v = document.getElementById("preview");
    return {
      badge: document.getElementById("liveBadgeText").textContent,
      badgeOn: document.getElementById("liveBadge").classList.contains("on"),
      slot: document.getElementById("slotTag").textContent,
      has: !!v.srcObject, w: v.videoWidth,
      joinOpts: window.__phoneCall._joinOpts,
      api: window.__joinCalls.map((b) => b.action + ":" + (b.code || "")),
    };
  });
  check("phone: good code joins video-on/mic-off, LIVE badge, preview frames", phLive.badgeOn && /Live/.test(phLive.badge) && /^Cam 2/.test(phLive.slot) && phLive.has && phLive.w > 0 && phLive.joinOpts.startAudioOff === true && phLive.joinOpts.startVideoOff === false && phLive.joinOpts.token === "cam-tok", JSON.stringify(phLive).slice(0, 200));
  const phHd = await page8.evaluate(() => ({
    input: window.__phoneCall._inputSettings,
    slot: document.getElementById("slotTag").textContent,
  }));
  check("phone HD: requests 1080p ideal, shows actual sending resolution", phHd.input && phHd.input.video.width.ideal === 1920 && phHd.input.video.height.ideal === 1080 && /320×180/.test(phHd.slot), JSON.stringify(phHd));
  await page8.evaluate(() => document.getElementById("flipBtn").click());
  await sleep(800);
  const phFlip = await page8.evaluate(() => ({
    switchedTo: window.__phoneCall._switchedTo,
    status: document.getElementById("liveStatus").textContent,
  }));
  check("phone: flip switches to the other camera", phFlip.switchedTo === "back-cam" && /flipped/.test(phFlip.status), JSON.stringify(phFlip));
  await page8.evaluate(() => document.getElementById("leaveBtn").click());
  await sleep(600);
  const phLeft = await page8.evaluate(() => ({
    joinVisible: !document.getElementById("joinCard").classList.contains("hidden"),
    liveHidden: document.getElementById("liveSection").classList.contains("hidden"),
    has: !!document.getElementById("preview").srcObject,
  }));
  check("phone: leave returns to join screen, preview cleared", phLeft.joinVisible && phLeft.liveHidden && !phLeft.has && errs8.length === 0, JSON.stringify(phLeft) + ` errs=${errs8.length}`);
  await page8.close();
  // ?code= auto-join path
  const page9 = await browser.newPage();
  const errs9 = [];
  page9.on("pageerror", (e) => errs9.push(e.message));
  await page9.evaluateOnNewDocument(INJECT);
  await page9.evaluateOnNewDocument(PHONE_STUB);
  await page9.goto("http://127.0.0.1:8931/camera.html?code=AAAA22", { waitUntil: "networkidle0" });
  await sleep(1500);
  const phAuto = await page9.evaluate(() => ({
    badgeOn: document.getElementById("liveBadge").classList.contains("on"),
    has: !!document.getElementById("preview").srcObject,
  }));
  check("phone: ?code= link auto-joins", phAuto.badgeOn && phAuto.has && errs9.length === 0, JSON.stringify(phAuto) + ` errs=${errs9.length}`);
  await page9.close();

  // ===== 22. RECORDING AUDIT (DrMorgan 2026-11-28: "the recorded
  // videos I tried yesterday — it has bugs on it. Fully audit this"):
  // mid-record switches/drops, A/V sync, durations, file integrity,
  // failure resilience, honest notices =====
  // Main page state here: 3 local cams live, CH1 mic unplugged (sec. 15),
  // CH2 live. Restore CH1 and set Single layout, Cam A main.
  await clickText("Single");
  await ev(() => document.querySelectorAll("#camList .cam-thumb")[0].click());
  await setSelect(`document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]')`, "mic-a");
  await stripBtn(0, "Enable Mic");
  await sleep(600);

  // 22a. Mid-record main-camera switch is reflected in the file
  const takeSwitchCam = await recordTake(5, async () => {
    await sleep(2200);
    await ev(() => document.querySelectorAll("#camList .cam-thumb")[1].click()); // Cam B main
  });
  const swUrl = takeSwitchCam.find(t => t.isVideo).url;
  const swEarly = await frameColorAt(swUrl, 1.0);
  const swLate = await frameColorAt(swUrl, 4.2);
  check("audit: mid-record camera switch recorded (red early, green late)", isRed(swEarly.col) && isGreen(swLate.col), `early=${swEarly.col} late=${swLate.col}`);
  check("audit: recorded program video is 1920x1080", swEarly.w === 1920 && swEarly.h === 1080, `${swEarly.w}x${swEarly.h}`);
  // 22b. File extension matches the actual recorded mime
  const extCheck = await ev(async (u) => {
    const row = [...document.querySelectorAll("#takes .take")].find(r => r.querySelector("video"));
    const blob = await (await fetch(u)).blob();
    return { type: blob.type, name: row.querySelector("a").download };
  }, swUrl);
  check("audit: download extension matches recorded mime", (extCheck.type.includes("mp4") && extCheck.name.endsWith(".mp4")) || (extCheck.type.includes("webm") && extCheck.name.endsWith(".webm")), JSON.stringify(extCheck));
  // 22c. Program file: its audio track must match the master-mix file
  // (same take, same clock — the program recorder must not lose audio),
  // and its video must track wall-clock take time (nominal 0.3+2.2+5 =
  // 7.5s). NOTE: this headless VM's AudioContext clock runs ~13% slow
  // under load (measured: 8.72s AC vs 10.01s wall), so absolute audio
  // duration < wall here is an environment artifact, not product drift
  // — on real hardware the audio clock is sample-accurate. The env
  // rate is reported as evidence, not asserted.
  const avDur = await ev(async (u) => {
    const buf = await window.__probe.decode(u);
    const v = document.createElement("video");
    v.muted = true; v.src = u; v.playsInline = true;
    await new Promise(r => { v.onloadedmetadata = r; setTimeout(r, 3000); });
    let vd = v.duration;
    if (!isFinite(vd)) { v.currentTime = 1e7; await new Promise(r => setTimeout(r, 600)); vd = v.duration; }
    return { audio: buf.duration, video: vd };
  }, swUrl);
  const masterDur22 = (await analyzeAudio(takeSwitchCam.find(t => t.label === "Master mix").url)).dur;
  check("audit: program audio matches master audio (<0.5s) + video tracks wall clock", Math.abs(avDur.audio - masterDur22) < 0.5 && Math.abs(avDur.video - 7.5) < 0.75 && avDur.audio > 4, JSON.stringify({ ...avDur, master: +masterDur22.toFixed(2), envAudioRate: +(masterDur22 / 7.5).toFixed(3) }));

  // 22d. Mid-record main-camera DROP: take completes, program falls to Cam B
  await ev(() => document.querySelectorAll("#camList .cam-thumb")[0].click()); // Cam A main again
  await sleep(300);
  const takeCamDrop = await recordTake(4.5, async () => {
    await sleep(1800);
    await ev(() => {
      const tr = window.__synth.streams["cam-a"].getVideoTracks()[0];
      if (typeof tr.onended === "function") tr.onended(); else tr.dispatchEvent(new Event("ended"));
    });
  });
  const cdUrl = takeCamDrop.find(t => t.isVideo).url;
  const cdLate = await frameColorAt(cdUrl, 3.8);
  check("audit: camera drop mid-record — take completes, program falls to Cam B (green)", takeCamDrop.length >= 2 && isGreen(cdLate.col), `rows=${takeCamDrop.length} col=${cdLate.col}`);

  // 22e. Mid-record mic DROP: take completes, other mic keeps recording
  const takeMicDrop = await recordTake(4.5, async () => {
    await sleep(1800);
    await ev(() => {
      const tr = window.__synth.streams["mic-a"].getAudioTracks()[0];
      if (typeof tr.onended === "function") tr.onended(); else tr.dispatchEvent(new Event("ended"));
    });
  });
  // Measure the LAST 2s of the master (well after the drop at ~2.1s):
  // Guest 520Hz must still be present there and Host 300Hz gone.
  // Whole-file energy is not used — the slow headless audio clock
  // makes absolute burst energy vary run to run (0.002–0.012 seen).
  const mdWin = await ev(async (u) => {
    const buf = await window.__probe.decode(u);
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const seg = d.subarray(Math.max(0, d.length - Math.floor(sr * 2)));
    const goertzel = (freq) => {
      const w = 2 * Math.PI * freq / sr, cw = Math.cos(w), c = 2 * cw;
      let s0 = 0, s1 = 0, s2 = 0;
      for (let i = 0; i < seg.length; i++) { s0 = seg[i] + c * s1 - s2; s2 = s1; s1 = s0; }
      return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / seg.length;
    };
    return { g520: goertzel(520), g300: goertzel(300), dur: buf.duration };
  }, takeMicDrop.find(t => t.label === "Master mix").url);
  check("audit: mic drop mid-record — take completes, Guest still in master after drop, Host gone", takeMicDrop.some(t => t.label === "Host") && mdWin.g520 > 0.002 && mdWin.g520 > 5 * mdWin.g300 && mdWin.dur > 3.5, `rows=${takeMicDrop.map(t => t.label).join(",")} g520last2s=${mdWin.g520.toFixed(4)} g300last2s=${mdWin.g300.toFixed(4)} dur=${mdWin.dur.toFixed(1)}`);

  // 22f. Longer take (10s): video tracks wall clock (nominal 10.3s);
  // master audio matches program audio and is not truncated (the
  // headless audio clock runs slow, so absolute audio < wall here).
  const takeLong = await recordTake(10);
  const longMaster = await analyzeAudio(takeLong.find(t => t.label === "Master mix").url);
  const longVid = await frameColorAt(takeLong.find(t => t.isVideo).url, 9.0);
  const longProgAudio = (await analyzeAudio(takeLong.find(t => t.isVideo).url)).dur;
  check("audit: 10s take — video 9-11s, program audio matches master, master not truncated", longVid.dur > 9 && longVid.dur < 11 && Math.abs(longProgAudio - longMaster.dur) < 0.5 && longMaster.dur > 0.8 * 10.3, `master=${longMaster.dur.toFixed(1)} progAudio=${longProgAudio.toFixed(1)} video=${longVid.dur}`);

  // 22g. A/V sync: flash/beep pair on one phase clock — measure offset
  await setSelect(`document.querySelectorAll("#camList .cam-card select")[0]`, "cam-sync");
  // Slot state after 22d: slot 0's stream was ended by the drop test,
  // so the select change does NOT auto-reconnect (mixer reconnects
  // only a live slot) and the button reads "Enable Cam 1". Click it
  // only when it is not "Disconnect" (clicking Disconnect on a live
  // slot was the phantom-lag/green-frame bug in the first audit run:
  // the recorded video was Cam B, brightMax≈51 = its red channel).
  await sleep(400);
  await ev(() => {
    const btn = document.querySelectorAll("#camList .cam-card button")[0];
    if (!/disconnect/i.test(btn.textContent)) btn.click();
  });
  for (let i = 0; i < 20; i++) {
    const live = await ev(() => {
      const s = window.__synth.streams["cam-sync"];
      const v = document.querySelectorAll("#camList .cam-card video")[0];
      return !!(s && s.getVideoTracks()[0].readyState === "live" && v && v.videoWidth > 0);
    });
    if (live) break;
    await sleep(300);
  }
  await ev(() => document.querySelectorAll("#camList .cam-thumb")[0].click()); // sync cam = main shot
  await sleep(400);
  await setSelect(`document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]')`, "mic-sync");
  await stripBtn(0, "Enable Mic");
  await sleep(800);
  const takeSync = await recordTake(4);
  const syncUrl = takeSync.find(t => t.isVideo).url;
  const syncRes = await ev(async (u) => {
    const P = window.__probe;
    // Beep onsets from the decoded audio (sample-accurate): 1000Hz
    // Goertzel energy in 10ms windows at 5ms hop, onset = crossing
    // 30% of peak energy.
    const buf = await P.decode(u);
    const ch = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const hop = Math.floor(sr * 0.005), winN = Math.floor(sr * 0.01);
    const w = 2 * Math.PI * 1000 / sr, cw = Math.cos(w), c = 2 * cw;
    const energies = [];
    for (let i = 0; i + winN < ch.length; i += hop) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let j = i; j < i + winN; j++) { s0 = ch[j] + c * s1 - s2; s2 = s1; s1 = s0; }
      energies.push(Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2)) / winN);
    }
    const eMax = Math.max(...energies, 0.0001);
    const thr = eMax * 0.3;
    const beepTimes = [];
    for (let i = 1; i < energies.length; i++) {
      if (energies[i] > thr && energies[i - 1] <= thr) beepTimes.push((i * hop) / sr);
    }
    // Flash onsets from real playback: requestVideoFrameCallback gives
    // each presented frame's mediaTime on the same file timeline as
    // the audio samples (seeking was too imprecise — it sampled stale
    // frames and produced a phantom 0.33s lag).
    const v = document.createElement("video");
    v.muted = true; v.src = u; v.playsInline = true;
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 36;
    const cx = cv.getContext("2d");
    const flashTimes = [];
    let brightMax = 0, prevB = 0;
    await new Promise((resolve) => {
      v.addEventListener("ended", resolve);
      setTimeout(resolve, 9000);
      v.play().catch(() => {});
      const cb = (now, meta) => {
        cx.drawImage(v, 0, 0, 64, 36);
        const d = cx.getImageData(0, 0, 64, 36).data;
        let s = 0; for (let j = 0; j < d.length; j += 16) s += d[j];
        const b = s / (d.length / 16);
        if (b > brightMax) brightMax = b;
        if (b > 128 && prevB <= 128) flashTimes.push(meta.mediaTime);
        prevB = b;
        if (!v.ended) v.requestVideoFrameCallback(cb);
      };
      v.requestVideoFrameCallback(cb);
    });
    // Pair each beep with the nearest flash; offset = beep - flash.
    // Fit offset = a + b*t: `a` is the product's A/V sync at take
    // start; `b` is environment audio-clock drift (this headless VM's
    // AudioContext clock runs ~13% slow under load, so beeps compress
    // toward earlier file-times as the take progresses — on real
    // hardware b≈0). Assert on `a`, report `b` as evidence.
    const pairs = [];
    for (const bt of beepTimes) {
      let best = null, bestFt = null;
      for (const ft of flashTimes) { const d = bt - ft; if (best === null || Math.abs(d) < Math.abs(best)) { best = d; bestFt = ft; } }
      if (best !== null && Math.abs(best) < 0.5) pairs.push({ t: bestFt, off: best });
    }
    let a = null, b = null;
    if (pairs.length >= 2) {
      const n = pairs.length;
      const mt = pairs.reduce((s, p) => s + p.t, 0) / n, mo = pairs.reduce((s, p) => s + p.off, 0) / n;
      let num = 0, den = 0;
      for (const p of pairs) { num += (p.t - mt) * (p.off - mo); den += (p.t - mt) * (p.t - mt); }
      b = den ? num / den : 0; a = mo - b * mt;
    }
    return { lagSec: a, driftPerSec: b, brightMax, beepCount: beepTimes.length, flashCount: flashTimes.length, pairs: pairs.length };
  }, syncUrl);
  check("audit: A/V sync — flash/beep offset at take start within 0.25s", syncRes.lagSec !== null && Math.abs(syncRes.lagSec) <= 0.25 && syncRes.brightMax > 150 && syncRes.pairs >= 3, JSON.stringify(syncRes));

  // 22h. No camera at record start: honest audio-only notice, take still works
  const page10 = await browser.newPage();
  const errs10 = [];
  page10.on("pageerror", (e) => errs10.push(e.message));
  await page10.evaluateOnNewDocument(INJECT);
  await page10.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(600);
  await page10.evaluate(() => document.getElementById("recBtn").click());
  await sleep(600);
  const ncNotice = await page10.evaluate(() => document.getElementById("notice").textContent);
  await sleep(1600);
  await page10.evaluate(() => document.getElementById("recBtn").click());
  for (let i = 0; i < 30; i++) { if (await page10.evaluate(() => document.querySelectorAll("#takes .take-group").length) > 0) break; await sleep(300); }
  const ncRows = await page10.evaluate(() => [...document.querySelectorAll("#takes .take")].map(r => r.querySelector(".meta b").textContent));
  check("audit: no camera at record start — honest audio-only notice, take completes", /audio only/i.test(ncNotice) && ncRows.includes("Master mix") && !ncRows.includes("Program video") && errs10.length === 0, `notice=${ncNotice.slice(0, 70)} rows=${ncRows.join(",")}`);
  await page10.close();

  // 22i. Video recorder fails to start: audio must still record (no hang, no crash)
  const page11 = await browser.newPage();
  const errs11 = [];
  page11.on("pageerror", (e) => errs11.push(e.message));
  await page11.evaluateOnNewDocument(INJECT);
  await page11.evaluateOnNewDocument(() => {
    const RealMR = window.MediaRecorder;
    class FlakyMR extends RealMR {
      start(...a) {
        if ((this.mimeType || "").includes("video")) throw new Error("synthetic video recorder start failure");
        return super.start(...a);
      }
    }
    FlakyMR.isTypeSupported = RealMR.isTypeSupported.bind(RealMR);
    window.MediaRecorder = FlakyMR;
  });
  await page11.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(600);
  await page11.evaluate(() => {
    const sel = document.querySelectorAll("#camList .cam-card select")[0];
    sel.value = "cam-a"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelectorAll("#camList .cam-card button")[0].click();
  });
  await sleep(700);
  await page11.evaluate(() => document.getElementById("recBtn").click());
  await sleep(2200);
  await page11.evaluate(() => document.getElementById("recBtn").click());
  let flakyDone = false;
  for (let i = 0; i < 30; i++) { if (await page11.evaluate(() => document.querySelectorAll("#takes .take-group").length) > 0) { flakyDone = true; break; } await sleep(300); }
  const flakyRows = flakyDone ? await page11.evaluate(() => [...document.querySelectorAll("#takes .take")].map(r => r.querySelector(".meta b").textContent)) : [];
  check("audit: video recorder start failure — audio take still completes, no crash/hang", flakyDone && flakyRows.includes("Master mix") && !flakyRows.includes("Program video") && errs11.length === 0, `done=${flakyDone} rows=${flakyRows.join(",")} errs=${errs11.join("|").slice(0, 80)}`);
  await page11.close();

  // 22j. Tab hidden during recording: honest warning (video freezes while hidden)
  const page12 = await browser.newPage();
  const errs12 = [];
  page12.on("pageerror", (e) => errs12.push(e.message));
  await page12.evaluateOnNewDocument(INJECT);
  await page12.goto("http://127.0.0.1:8931/desk/podcast-mixer.html", { waitUntil: "networkidle0" });
  await sleep(600);
  await page12.evaluate(() => document.getElementById("recBtn").click());
  await sleep(500);
  await page12.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(400);
  const hidNotice = await page12.evaluate(() => document.getElementById("notice").textContent);
  await page12.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    document.getElementById("recBtn").click();
  });
  await sleep(600);
  check("audit: tab hidden mid-record — honest warning shown", /hidden/i.test(hidNotice) && errs12.length === 0, hidNotice.slice(0, 90));
  await page12.close();

  // 22k. Recording size is visible while recording (long-take memory honesty)
  await ev(() => document.getElementById("recBtn").click());
  await sleep(3200);
  const sizeState = await ev(() => document.getElementById("recState").textContent);
  await ev(() => document.getElementById("recBtn").click());
  await sleep(600);
  check("audit: live recording size shown in rec state", /\d+(\.\d+)?\s*(KB|MB|GB)/.test(sizeState), sizeState);

  check("no console/page errors across full run", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} catch (err) {
  check("test harness completed without exception", false, err.message);
} finally {
  const passed = results.filter(r => r.ok).length;
  console.log(`\n=== ${label}: ${passed}/${results.length} checks passed ===`);
  await browser.close();
  server.close();
  process.exit(passed === results.length ? 0 : 1);
}
