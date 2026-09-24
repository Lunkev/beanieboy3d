import * as THREE from "three";
import type { FloorKind, WallKind } from "../types";

// Procedurella canvas-texturer. Allt ritas i kod så rummet ser bra ut utan en enda bildfil.

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d")!;
  return { c, x };
}

function tex(c: HTMLCanvasElement, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

/** Deterministisk slump så texturerna blir lika vid varje laddning. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function noise(x: CanvasRenderingContext2D, w: number, h: number, alpha: number, seed = 1) {
  const r = rng(seed);
  const img = x.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 255 * alpha;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
}

export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + amt, 0, 1));
  return "#" + c.getHexString();
}

export function floorTexture(kind: FloorKind, a: string, b: string, repeat = 3) {
  const S = 512;
  const { c, x } = canvas(S, S);
  const r = rng(7);
  if (kind === "checker" || kind === "tile") {
    const n = kind === "checker" ? 4 : 8, s = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      x.fillStyle = (i + j) % 2 ? a : b;
      if (kind === "tile") x.fillStyle = r() > 0.5 ? a : shade(a, (r() - 0.5) * 0.06);
      x.fillRect(i * s, j * s, s, s);
      // marmorådring
      x.strokeStyle = "rgba(255,255,255,0.07)";
      for (let v = 0; v < 3; v++) {
        x.beginPath(); const sx = i * s + r() * s, sy = j * s + r() * s;
        x.moveTo(sx, sy); x.bezierCurveTo(sx + 30, sy + 20, sx - 20, sy + 40, sx + 15, sy + s * 0.7); x.stroke();
      }
    }
    if (kind === "tile") { x.strokeStyle = b; x.lineWidth = 4; for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * s, 0); x.lineTo(i * s, S); x.moveTo(0, i * s); x.lineTo(S, i * s); x.stroke(); } }
  } else if (kind === "wood") {
    const rows = 8, rh = S / rows;
    for (let j = 0; j < rows; j++) {
      let xx = -r() * 200;
      while (xx < S) {
        const len = 160 + r() * 200;
        x.fillStyle = shade(r() > 0.5 ? a : b, (r() - 0.5) * 0.05);
        x.fillRect(xx, j * rh, len, rh);
        x.strokeStyle = "rgba(0,0,0,0.08)";
        for (let g = 0; g < 6; g++) { x.beginPath(); const gy = j * rh + r() * rh; x.moveTo(xx, gy); x.bezierCurveTo(xx + len * 0.3, gy + 3, xx + len * 0.6, gy - 3, xx + len, gy); x.stroke(); }
        x.fillStyle = "rgba(0,0,0,0.35)"; x.fillRect(xx, j * rh, 2, rh);
        xx += len;
      }
      x.fillStyle = "rgba(0,0,0,0.3)"; x.fillRect(0, j * rh, S, 2);
    }
  } else if (kind === "carpet") {
    x.fillStyle = a; x.fillRect(0, 0, S, S);
    noise(x, S, S, 0.18, 3);
    x.globalAlpha = 0.18; x.strokeStyle = b; x.lineWidth = 10;
    for (let i = -S; i < S * 2; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke(); }
    x.globalAlpha = 1;
  } else if (kind === "tatami") {
    x.fillStyle = a; x.fillRect(0, 0, S, S);
    x.strokeStyle = "rgba(0,0,0,0.08)"; for (let i = 0; i < S; i += 4) { x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke(); }
    x.fillStyle = b; x.fillRect(0, 0, S, 18); x.fillRect(0, S / 2, S, 18); x.fillRect(S / 2 - 9, 18, 18, S / 2 - 18);
  } else {
    x.fillStyle = a; x.fillRect(0, 0, S, S); noise(x, S, S, 0.12, 9);
    x.fillStyle = "rgba(0,0,0,0.12)"; for (let i = 0; i < 40; i++) { x.beginPath(); x.arc(r() * S, r() * S, r() * 18, 0, 7); x.fill(); }
  }
  noise(x, S, S, 0.04, 11);
  return tex(c, repeat);
}

export function wallTexture(kind: WallKind, a: string, b: string) {
  const S = 512;
  const { c, x } = canvas(S, S);
  const r = rng(21);
  x.fillStyle = a; x.fillRect(0, 0, S, S);
  if (kind === "stripes") {
    for (let i = 0; i < S; i += 64) { x.fillStyle = b; x.fillRect(i, 0, 26, S); }
  } else if (kind === "panel" || kind === "wood") {
    const n = kind === "wood" ? 8 : 4, w = S / n;
    for (let i = 0; i < n; i++) {
      x.fillStyle = shade(a, (r() - 0.5) * 0.05); x.fillRect(i * w, 0, w, S);
      x.fillStyle = "rgba(0,0,0,0.25)"; x.fillRect(i * w, 0, 3, S);
      if (kind === "panel") { x.strokeStyle = b; x.lineWidth = 6; x.strokeRect(i * w + 18, 30, w - 36, S * 0.42); x.strokeRect(i * w + 18, S * 0.52, w - 36, S * 0.42); }
    }
  } else if (kind === "brick") {
    const bh = 32, bw = 96;
    for (let j = 0; j < S / bh; j++) for (let i = -1; i < S / bw + 1; i++) {
      const off = j % 2 ? bw / 2 : 0;
      x.fillStyle = shade(a, (r() - 0.5) * 0.08);
      x.fillRect(i * bw + off + 3, j * bh + 3, bw - 6, bh - 6);
    }
    x.globalCompositeOperation = "destination-over"; x.fillStyle = b; x.fillRect(0, 0, S, S); x.globalCompositeOperation = "source-over";
  } else if (kind === "tile") {
    const s = 64;
    for (let i = 0; i < S / s; i++) for (let j = 0; j < S / s; j++) { x.fillStyle = shade(a, (r() - 0.5) * 0.05); x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    x.globalCompositeOperation = "destination-over"; x.fillStyle = b; x.fillRect(0, 0, S, S); x.globalCompositeOperation = "source-over";
  } else if (kind === "damask") {
    x.fillStyle = b; x.globalAlpha = 0.35;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const cx = i * 128 + (j % 2 ? 64 : 0), cy = j * 128 + 64;
      x.beginPath(); x.ellipse(cx, cy, 22, 44, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(cx, cy, 44, 14, 0, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
  }
  noise(x, S, S, 0.05, 5);
  return tex(c, 1);
}

export function rugTexture(a: string, b: string, round: boolean) {
  const S = 512; const { c, x } = canvas(S, S);
  if (round) {
    const ring = (r: number, col: string) => { x.fillStyle = col; x.beginPath(); x.arc(S / 2, S / 2, r, 0, 7); x.fill(); };
    ring(S / 2, b); ring(S / 2 - 18, a); ring(S / 2 - 40, shade(a, 0.06)); ring(S / 2 - 46, b); ring(S / 2 - 52, shade(a, 0.06));
    // tofsar i kanten
    x.strokeStyle = b; x.lineWidth = 3;
    for (let k = 0; k < 90; k++) { const t = (k / 90) * Math.PI * 2; x.beginPath(); x.moveTo(S / 2 + Math.cos(t) * (S / 2 - 20), S / 2 + Math.sin(t) * (S / 2 - 20)); x.lineTo(S / 2 + Math.cos(t) * (S / 2 - 2), S / 2 + Math.sin(t) * (S / 2 - 2)); x.stroke(); }
    x.globalAlpha = 0.25; ring(S / 5, b); x.globalAlpha = 1;
  } else {
    x.fillStyle = a; x.fillRect(0, 0, S, S);
    x.strokeStyle = b; x.lineWidth = 14; x.strokeRect(24, 24, S - 48, S - 48); x.lineWidth = 5; x.strokeRect(50, 50, S - 100, S - 100);
    x.fillStyle = b; x.save(); x.translate(S / 2, S / 2); x.rotate(Math.PI / 4); x.fillRect(-70, -70, 140, 140); x.restore();
  }
  noise(x, S, S, 0.15, 4);
  const t = tex(c, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

export function skyTexture(kind: "night" | "sunset" | "day" | "space") {
  const { c, x } = canvas(256, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  const stops: Record<string, string[]> = {
    night: ["#0b1a3a", "#1d3b73", "#3a5aa0"],
    sunset: ["#3b1d5e", "#d9577a", "#ffb36b"],
    day: ["#5aa9ff", "#9fd0ff", "#e6f4ff"],
    space: ["#05030d", "#140a2e", "#2a1050"],
  };
  const s = stops[kind];
  g.addColorStop(0, s[0]); g.addColorStop(0.6, s[1]); g.addColorStop(1, s[2]);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  if (kind === "night" || kind === "space") {
    const r = rng(3);
    for (let i = 0; i < 80; i++) { x.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`; x.fillRect(r() * 256, r() * 180, r() > 0.9 ? 2 : 1, r() > 0.9 ? 2 : 1); }
    x.fillStyle = "#fff8d0"; x.beginPath(); x.arc(190, 60, 18, 0, 7); x.fill();
  }
  if (kind === "sunset") { x.fillStyle = "#ffe29a"; x.beginPath(); x.arc(128, 200, 40, 0, 7); x.fill(); }
  // stadssiluett
  x.fillStyle = kind === "day" ? "rgba(40,60,90,0.5)" : "rgba(5,5,15,0.85)";
  const r = rng(12); let xx = 0;
  while (xx < 256) { const w = 14 + r() * 26, h = 30 + r() * 80; x.fillRect(xx, 256 - h, w, h); if (kind !== "day") { x.fillStyle = "rgba(255,220,140,0.8)"; for (let k = 0; k < 6; k++) x.fillRect(xx + 3 + r() * (w - 6), 256 - h + 6 + r() * (h - 12), 2, 2); x.fillStyle = "rgba(5,5,15,0.85)"; } xx += w + 2; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function glowTexture(color: string) {
  const { c, x } = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  const col = new THREE.Color(color);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  g.addColorStop(0, `rgba(${rgb},0.9)`); g.addColorStop(0.35, `rgba(${rgb},0.35)`); g.addColorStop(1, `rgba(${rgb},0)`);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function blobShadowTexture() {
  const { c, x } = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(0.6, "rgba(0,0,0,0.2)"); g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function shaftTexture() {
  const { c, x } = canvas(64, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  const h = x.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, "rgba(0,0,0,1)"); h.addColorStop(0.2, "rgba(0,0,0,0)"); h.addColorStop(0.8, "rgba(0,0,0,0)"); h.addColorStop(1, "rgba(0,0,0,1)");
  x.globalCompositeOperation = "destination-out"; x.fillStyle = h; x.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

export function neonTexture(text: string, color: string, font: string) {
  const { c, x } = canvas(1024, 256);
  x.font = `900 150px ${font}`;
  const w = Math.min(1000, x.measureText(text).width + 60);
  c.width = Math.ceil(w); c.height = 256;
  const y = c.getContext("2d")!;
  y.font = `900 150px ${font}`; y.textAlign = "center"; y.textBaseline = "middle";
  y.shadowColor = color; y.shadowBlur = 40; y.fillStyle = color;
  y.fillText(text, c.width / 2, 132); y.fillText(text, c.width / 2, 132);
  y.shadowBlur = 0; y.fillStyle = "#ffffff"; y.globalAlpha = 0.85; y.fillText(text, c.width / 2, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: c.width / c.height };
}
