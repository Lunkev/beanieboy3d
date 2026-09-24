// Små UI-ljud syntade med WebAudio — inga ljudfiler behövs.
let ctx: AudioContext | null = null;
let muted = false;
export function setSfxMuted(m: boolean) { muted = m; setAmbienceMuted(m); }
export function unlockAudio() {
  try { ctx ??= new AudioContext(); if (ctx.state === "suspended") ctx.resume(); } catch { /* ingen ljud-API */ }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
  if (!ctx || muted) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur);
}

function noise(dur: number, vol: number, from: number, to: number) {
  if (!ctx || muted) return;
  const len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
  src.buffer = buf; f.type = "bandpass"; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur); f.Q.value = 1.2;
  g.gain.value = vol; src.connect(f).connect(g).connect(ctx.destination); src.start(t);
}

export function sfx(kind: "hover" | "click" | "whoosh" | "pop" | "copy" | "open" | "clunk" | "static" | "beep" | "warp") {
  if (kind === "hover") tone(1400, 0.04, "square", 0.015);
  else if (kind === "click") { tone(620, 0.07, "square", 0.04, 1.6); }
  else if (kind === "whoosh") noise(0.7, 0.18, 300, 2400);
  else if (kind === "pop") { tone(420, 0.12, "sine", 0.12, 2.4); setTimeout(() => tone(880, 0.1, "triangle", 0.06, 1.5), 60); }
  else if (kind === "copy") { tone(880, 0.06, "square", 0.04); setTimeout(() => tone(1320, 0.09, "square", 0.04), 70); }
  else if (kind === "open") tone(520, 0.14, "triangle", 0.07, 1.8);
  else if (kind === "clunk") { tone(90, 0.18, "square", 0.12, 0.5); setTimeout(() => noise(0.12, 0.2, 800, 300), 90); }
  else if (kind === "static") noise(0.6, 0.22, 5000, 3000);
  else if (kind === "beep") tone(1760, 0.09, "sine", 0.06);
  else if (kind === "warp") { noise(2.6, 0.3, 200, 6000); tone(80, 2.6, "sawtooth", 0.05, 6); }
}

// ───────────────────────── Fotsteg ─────────────────────────
// Syntade steg per underlag: prassel + små knaster (strån som böjs) + en mjuk duns. Slumpas lite varje steg
// så det aldrig låter som samma sampel, och panoreras svagt vänster/höger efter vilken fot som sätts ned.
export type Surface = "grass" | "path" | "sand" | "wood";
const STEP: Record<Surface, { f: number; hp: number; dur: number; grains: number; vol: number; thump: number; tf: number }> = {
  grass: { f: 3400, hp: 1300, dur: 0.12, grains: 16, vol: 0.2, thump: 0.05, tf: 120 },
  path: { f: 1600, hp: 450, dur: 0.09, grains: 26, vol: 0.17, thump: 0.08, tf: 140 },
  sand: { f: 950, hp: 180, dur: 0.15, grains: 7, vol: 0.14, thump: 0.05, tf: 100 },
  wood: { f: 1200, hp: 280, dur: 0.06, grains: 4, vol: 0.08, thump: 0.16, tf: 210 },
};
let lastStep = 0;
export function footstep(surface: Surface = "grass", run = false, side = 0, vol = 1) {
  if (!ctx || muted || ctx.state !== "running") return;
  const t = ctx.currentTime; if (t - lastStep < 0.09) return; lastStep = t;
  const S = STEP[surface], rnd = (a: number, b: number) => a + Math.random() * (b - a), sr = ctx.sampleRate;
  const len = Math.floor(sr * S.dur * (run ? 0.8 : 1) * rnd(0.85, 1.15)), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  const atk = sr * 0.004;
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.min(1, i / atk) * Math.pow(1 - i / len, 2.2) * 0.5;
  for (let g = 0; g < S.grains; g++) { // knaster, tätast i början av steget
    const at = Math.floor(Math.pow(Math.random(), 1.6) * len * 0.85), gl = Math.floor(sr * rnd(0.001, 0.004)), a = rnd(0.25, 1);
    for (let i = 0; i < gl && at + i < len; i++) d[at + i] += (Math.random() * 2 - 1) * a * (1 - i / gl);
  }
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rnd(0.9, 1.12);
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = S.hp * rnd(0.85, 1.15);
  const pk = ctx.createBiquadFilter(); pk.type = "peaking"; pk.frequency.value = S.f * rnd(0.85, 1.2); pk.Q.value = 0.9; pk.gain.value = 6;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = S.f * 2.2;
  const g = ctx.createGain(); g.gain.value = S.vol * vol * (run ? 1.35 : 1) * rnd(0.8, 1.1);
  const pan = ctx.createStereoPanner(); pan.pan.value = side * 0.14;
  src.connect(hp).connect(pk).connect(lp).connect(g).connect(pan).connect(ctx.destination); src.start(t);
  // mjuk duns (liten katt = lätt)
  const o = ctx.createOscillator(), og = ctx.createGain(); o.type = surface === "wood" ? "triangle" : "sine";
  o.frequency.setValueAtTime(S.tf * rnd(0.9, 1.1), t); o.frequency.exponentialRampToValueAtTime(S.tf * 0.45, t + 0.07);
  og.gain.setValueAtTime(S.thump * vol * (run ? 1.3 : 1), t); og.gain.exponentialRampToValueAtTime(0.0001, t + (surface === "wood" ? 0.11 : 0.07));
  o.connect(og).connect(pan); o.start(t); o.stop(t + 0.13);
  src.onended = () => pan.disconnect();
}

// ───────────────────────── Stämningsljud (ambience) ─────────────────────────
// Syntad bakgrundsmatta: pad (detunade oscillatorer genom ett svepande lågpass), vind/brus, ev. arpeggio.
export type Ambience = "warm" | "night" | "dreamy" | "arcade" | "tape" | "cctv";
type Amb = { master: GainNode; filter: BiquadFilterNode; wind: GainNode; stop: () => void; base: number; windBase: number };
let amb: Amb | null = null;
let ambVol = 1;

function noiseBuffer(sec: number) {
  const len = Math.floor(ctx!.sampleRate * sec), buf = ctx!.createBuffer(1, len, ctx!.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function startAmbience(mood: Ambience, vol = 1) {
  unlockAudio(); if (!ctx) return;
  stopAmbience(0.4);
  const t = ctx.currentTime, master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  ambVol = vol;
  const target = (muted ? 0 : 0.32) * vol;
  master.gain.linearRampToValueAtTime(target, t + 2.5);
  const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = 0.7; filter.connect(master);
  const oscs: (OscillatorNode | AudioBufferSourceNode)[] = [];
  const P: Record<Ambience, { notes: number[]; type: OscillatorType; cut: number; wind: number; windF: number; gain: number }> = {
    warm: { notes: [110, 138.6, 164.8, 220], type: "sawtooth", cut: 680, wind: 0.05, windF: 520, gain: 0.05 },
    night: { notes: [98, 123.5, 146.8, 196], type: "triangle", cut: 520, wind: 0.035, windF: 380, gain: 0.08 },
    dreamy: { notes: [130.8, 164.8, 196, 246.9], type: "triangle", cut: 950, wind: 0.05, windF: 260, gain: 0.07 },
    arcade: { notes: [65.4, 98], type: "square", cut: 420, wind: 0, windF: 500, gain: 0.03 },
    tape: { notes: [60, 120], type: "sine", cut: 300, wind: 0.03, windF: 5000, gain: 0.05 },
    cctv: { notes: [50, 100, 150], type: "sine", cut: 400, wind: 0.025, windF: 6000, gain: 0.05 },
  };
  const p = P[mood];
  filter.frequency.value = p.cut;
  for (const f of p.notes) for (const det of [-4, 4]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = p.type; o.frequency.value = f; o.detune.value = det; g.gain.value = p.gain;
    o.connect(g).connect(filter); o.start(t); oscs.push(o);
  }
  // långsam LFO på filtret → matta som andas
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = p.cut * 0.2; lfo.connect(lg).connect(filter.frequency); lfo.start(t); oscs.push(lfo);
  // vind / brus
  const ns = ctx.createBufferSource(); ns.buffer = noiseBuffer(4); ns.loop = true;
  const nf = ctx.createBiquadFilter(); nf.type = mood === "tape" || mood === "cctv" ? "highpass" : "bandpass"; nf.frequency.value = p.windF; nf.Q.value = 0.5;
  const wind = ctx.createGain(); wind.gain.value = p.wind; ns.connect(nf).connect(wind).connect(master); ns.start(t); oscs.push(ns);
  if (mood === "dreamy") { // havsvågor: brusets volym gungar
    const wl = ctx.createOscillator(), wg = ctx.createGain(); wl.frequency.value = 0.12; wg.gain.value = 0.04; wl.connect(wg).connect(wind.gain); wl.start(t); oscs.push(wl);
  }
  let arp: ReturnType<typeof setInterval> | null = null;
  if (mood === "arcade") { // lugnt arpeggio i moll-pentatonik
    const scale = [261.6, 311.1, 349.2, 392, 466.2, 523.3]; let i = 0;
    arp = setInterval(() => {
      if (!ctx || muted) return; const tt = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = scale[[0, 2, 4, 2, 1, 3, 5, 3][i++ % 8]]; g.gain.setValueAtTime(0.018, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.22);
      o.connect(g).connect(master); o.start(tt); o.stop(tt + 0.25);
    }, 260);
  }
  amb = { master, filter, wind, base: p.cut, windBase: p.wind, stop: () => { oscs.forEach((o) => { try { o.stop(); } catch { /* redan stoppad */ } }); if (arp) clearInterval(arp); master.disconnect(); } };
}

/** 0..1: öppnar filtret och höjer vinden (warp/whoosh). */
export function swellAmbience(k: number, sec = 0.3) {
  if (!amb || !ctx) return; const t = ctx.currentTime;
  amb.filter.frequency.setTargetAtTime(amb.base + k * 4600, t, sec);
  amb.wind.gain.setTargetAtTime(amb.windBase + k * 0.28, t, sec);
  amb.master.gain.setTargetAtTime((muted ? 0 : 0.32) * ambVol * (1 + k * 1.6), t, sec);
}

export function stopAmbience(fade = 1) {
  if (!amb || !ctx) return; const a = amb; amb = null;
  a.master.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
  setTimeout(a.stop, fade * 1000 + 200);
}

export function setAmbienceMuted(m: boolean) { if (amb && ctx) amb.master.gain.setTargetAtTime(m ? 0 : 0.32 * ambVol, ctx.currentTime, 0.1); }
