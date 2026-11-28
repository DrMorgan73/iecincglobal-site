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

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
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
    c.width = 640; c.height = 360;
    const x = c.getContext("2d");
    let t = 0;
    (function draw() {
      t++;
      x.fillStyle = def.color; x.fillRect(0, 0, 640, 360);
      x.fillStyle = "rgba(255,255,255,0.9)";
      x.beginPath(); x.arc(60 + (t * 3) % 520, 40, 16, 0, 7); x.fill();
      x.fillStyle = "#ffffff"; x.font = "bold 72px sans-serif";
      x.fillText(def.label, 180, 210);
      requestAnimationFrame(draw);
    })();
    const s = c.captureStream(30);
    synth.streams[id] = s;
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
    const iv = setInterval(() => { on = !on; g.gain.setTargetAtTime(on ? 0.15 : 0, ac.currentTime, 0.02); }, 600);
    const s = dest.stream;
    s.getAudioTracks().forEach((tr) => tr.addEventListener("ended", () => clearInterval(iv)));
    synth.streams[id] = s;
    return s;
  }
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (window.__denyMedia) {
      const e = new Error("Permission denied"); e.name = "NotAllowedError"; throw e;
    }
    actx();
    if (constraints && constraints.video) {
      const id = (constraints.video.deviceId && constraints.video.deviceId.exact) || "cam-a";
      return makeCamStream(id);
    }
    if (constraints && constraints.audio) {
      const id = (constraints.audio.deviceId && constraints.audio.deviceId.exact) || "mic-a";
      return makeMicStream(id);
    }
    throw new Error("no constraints");
  };
  navigator.mediaDevices.enumerateDevices = async () => [
    { deviceId: "mic-a", kind: "audioinput", label: "Synthetic Mic A (300Hz)", groupId: "g1" },
    { deviceId: "mic-b", kind: "audioinput", label: "Synthetic Mic B (520Hz)", groupId: "g2" },
    { deviceId: "cam-a", kind: "videoinput", label: "Synthetic Cam A (red)", groupId: "g3" },
    { deviceId: "cam-b", kind: "videoinput", label: "Synthetic Cam B (green)", groupId: "g4" },
    { deviceId: "cam-c", kind: "videoinput", label: "Synthetic Cam C (blue)", groupId: "g5" },
  ];

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
  const camOpts = await ev(() => [...document.querySelectorAll(".cam-card select")].map(s => [...s.options].map(o => o.textContent)));
  check("camera dropdowns enumerate 3 labeled cameras at load", camOpts.length === 3 && camOpts[0].filter(t => t.includes("Synthetic Cam")).length === 3, JSON.stringify(camOpts[0]));

  // ===== 1. Cameras on =====
  for (let i = 0; i < 3; i++) {
    await setSelect(`document.querySelectorAll(".cam-card select")[${i}]`, ["cam-a", "cam-b", "cam-c"][i]);
    await ev((idx) => document.querySelectorAll(".cam-card button")[idx].click(), i);
    await sleep(500);
  }
  const camStates = await ev(() => [...document.querySelectorAll(".cam-card video")].map(v => ({ has: !!v.srcObject, w: v.videoWidth, paused: v.paused })));
  check("all 3 cameras live with video frames", camStates.every(c => c.has && c.w > 0), JSON.stringify(camStates));
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
  await setSelect(`document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]')`, "mic-b");
  await sleep(900);
  const tagAfterSwitch = await ev(() => document.querySelectorAll(".strip")[0].querySelector('[data-role="livetag"]').textContent);
  const takeSwitch = await recordTake(3);
  const hostSwitch = await analyzeAudio(takeSwitch.find(t => t.label === "Host").url);
  check("live switch CH1 mic-a→mic-b: stream follows dropdown (520Hz on Host)", tagAfterSwitch === "Mic live" && hostSwitch.g520 > 0.01 && hostSwitch.g520 > hostSwitch.g300 * 4, `tag=${tagAfterSwitch} g300=${hostSwitch.g300.toFixed(3)} g520=${hostSwitch.g520.toFixed(3)}`);
  await setSelect(`document.querySelectorAll(".strip")[0].querySelector('select[aria-label="Microphone device"]')`, "mic-a");
  await sleep(900);
  const takeSwitchBack = await recordTake(3);
  const hostBack = await analyzeAudio(takeSwitchBack.find(t => t.label === "Host").url);
  check("live switch back CH1 mic-b→mic-a: 300Hz restored on Host", hostBack.g300 > 0.01 && hostBack.g300 > hostBack.g520 * 4, `g300=${hostBack.g300.toFixed(3)} g520=${hostBack.g520.toFixed(3)}`);

  // ===== 5. Full record: video + master + per-mic tracks =====
  await clickText("Side-by-Side");
  const take1 = await recordTake(4);
  const labels1 = take1.map(t => t.label);
  check("take has Program video + Master mix + 2 mic tracks", take1.length === 4 && labels1.includes("Program video") && labels1.includes("Master mix"), JSON.stringify(labels1));
  const master1 = await analyzeAudio(take1.find(t => t.label === "Master mix").url);
  check("master mix non-silent, ~4s", master1.rms0 > 0.01 && master1.dur > 3 && master1.dur < 6, `rms=${master1.rms0.toFixed(3)} dur=${master1.dur.toFixed(1)}`);
  check("master mix contains BOTH 300Hz and 520Hz", master1.g300 > 0.01 && master1.g520 > 0.01, `g300=${master1.g300.toFixed(3)} g520=${master1.g520.toFixed(3)}`);
  const host = await analyzeAudio(take1.find(t => t.label === "Host").url);
  const guest = await analyzeAudio(take1.find(t => t.label === "Guest").url);
  check("Host track: 300Hz present, 520Hz absent (separation)", host.g300 > 0.01 && host.g300 > host.g520 * 4, `g300=${host.g300.toFixed(3)} g520=${host.g520.toFixed(3)}`);
  check("Guest track: 520Hz present, 300Hz absent (separation)", guest.g520 > 0.01 && guest.g520 > guest.g300 * 4, `g520=${guest.g520.toFixed(3)} g300=${guest.g300.toFixed(3)}`);
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
  check("Mute CH1: master keeps 520Hz, loses 300Hz", masterMute.g520 > 0.01 && masterMute.g520 > masterMute.g300 * 4, `g300=${masterMute.g300.toFixed(3)} g520=${masterMute.g520.toFixed(3)}`);
  await stripBtn(0, "Mute"); // unmute
  await stripBtn(1, "Solo");
  const takeSolo = await recordTake(3);
  const masterSolo = await analyzeAudio(takeSolo.find(t => t.label === "Master mix").url);
  check("Solo CH2: master has 520Hz only", masterSolo.g520 > 0.01 && masterSolo.g520 > masterSolo.g300 * 4, `g300=${masterSolo.g300.toFixed(3)} g520=${masterSolo.g520.toFixed(3)}`);
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
  const dupCamOpts = await page3.evaluate(() => [...document.querySelectorAll(".cam-card select")].map(s => [...s.options].map(o => o.textContent)));
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
  check("numbered entries bind right deviceId: Host=mic-b 520Hz, Guest=mic-a 300Hz", dupHost.g520 > 0.01 && dupHost.g520 > dupHost.g300 * 4 && dupGuest.g300 > 0.01 && dupGuest.g300 > dupGuest.g520 * 4 && errs3.length === 0, `host g300=${dupHost.g300.toFixed(3)} g520=${dupHost.g520.toFixed(3)} | guest g300=${dupGuest.g300.toFixed(3)} g520=${dupGuest.g520.toFixed(3)} errs=${errs3.length}`);
  await page3.close();

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
