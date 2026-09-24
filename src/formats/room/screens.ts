import * as THREE from "three";
import type { ScreenConfig, SiteConfig } from "../../types";
import type { Interactive } from "../../core/interactive";

/** Levande skärmar (TV, monitor, skylt) ritade på canvas — memes-bildspel, ticker, fejkchart, CA. */
export function buildScreens(cfg: SiteConfig, scene: THREE.Scene, props: Map<string, THREE.Object3D>, list: ScreenConfig[] = cfg.room?.screens ?? []) {
  const interactives: Interactive[] = [];
  const updaters: ((t: number, dt: number) => void)[] = [];
  const editables: { id: string; obj: THREE.Object3D }[] = [];
  const imgCache = new Map<string, HTMLImageElement>();
  const img = (src: string) => {
    let i = imgCache.get(src);
    if (!i) { i = new Image(); i.src = src; imgCache.set(src, i); }
    return i.complete && i.naturalWidth ? i : null;
  };
  const P = cfg.palette;
  const display = `"${cfg.fonts.display}", Impact, sans-serif`;
  const body = `"${cfg.fonts.body}", system-ui, sans-serif`;
  const caShort = cfg.ca ? cfg.ca.slice(0, 5) + "…" + cfg.ca.slice(-5) : "coming soon";

  list.forEach((s: ScreenConfig, idx) => {
    // --- placering: fäst på en prop, eller fri ---
    let parent: THREE.Object3D = scene, sw = s.w ?? 1, sh = s.h ?? 0.6;
    const place = new THREE.Vector3(...(s.pos ?? [0, 1, 0])); let rot = s.rotY ?? 0;
    if (s.attach) {
      const host = props.get(s.attach.prop);
      if (!host) { console.warn("[memeroom] skärm", idx, "hittar inte prop", s.attach.prop); return; }
      // propens box i sitt eget (oroterade) koordinatsystem
      const inner = host.children[0]; inner.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const inv = new THREE.Matrix4().copy(host.matrixWorld).invert();
      inner.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); box.union(b); });
      const [u0, v0, u1, v1] = s.attach.rect, sz = box.getSize(new THREE.Vector3());
      sw = sz.x * (u1 - u0); sh = sz.y * (v1 - v0);
      place.set(box.min.x + sz.x * (u0 + u1) / 2, box.min.y + sz.y * (v0 + v1) / 2, box.max.z + (s.attach.z ?? 0.01) * sz.z);
      parent = host; rot = 0;
    }
    const RES = 512, W = RES, H = Math.max(64, Math.round(RES * (sh / sw)));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d")!;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.08, 1.08, 1.08) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
    mesh.position.copy(place); mesh.rotation.y = rot; mesh.name = `screen:${idx}:${s.kind}`;
    parent.add(mesh); mesh.updateMatrixWorld(true);
    if (!s.attach) editables.push({ id: mesh.name, obj: mesh });
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld).setY(0).normalize();
    const light = new THREE.PointLight(P.accent, 0.9, 3.2, 2);
    light.position.copy(mesh.getWorldPosition(new THREE.Vector3())).addScaledVector(normal, 0.5);
    scene.add(light);
    if (s.open || s.label) interactives.push({ obj: mesh, open: s.open, label: s.label, id: mesh.name, normal });

    let acc = 0, frame = 0;
    const candles: number[] = []; let price = 50;
    for (let i = 0; i < 40; i++) { price += (Math.random() - 0.35) * 6; candles.push(price); }

    const draw = (t: number) => {
      frame++;
      x.save();
      if (s.kind === "memes" && cfg.memes.length) {
        const n = cfg.memes.length, k = t / 3.5, cur = Math.floor(k) % n, prev = (cur - 1 + n) % n, f = Math.min(1, (k % 1) / 0.12);
        x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
        const cover = (im: HTMLImageElement | null, alpha: number) => { if (!im) return; const r = Math.max(W / im.width, H / im.height); x.globalAlpha = alpha; x.drawImage(im, (W - im.width * r) / 2, (H - im.height * r) / 2, im.width * r, im.height * r); x.globalAlpha = 1; };
        if (f < 1) cover(img(cfg.memes[prev]), 1);
        cover(img(cfg.memes[cur]), f);
        x.fillStyle = "rgba(0,0,0,.55)"; x.fillRect(12, 12, 150, 30);
        x.fillStyle = P.accent; x.font = `700 18px ${body}`; x.fillText(frame % 40 < 20 ? "● MEMES.EXE" : "  MEMES.EXE", 20, 33);
      } else if (s.kind === "ticker" || s.kind === "ca") {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, P.panel); g.addColorStop(1, "#000"); x.fillStyle = g; x.fillRect(0, 0, W, H);
        x.textAlign = "center"; x.fillStyle = P.accent;
        const big = s.kind === "ticker" ? cfg.ticker : "CONTRACT";
        x.font = `900 ${Math.min(H * 0.42, (W / big.length) * 1.6)}px ${display}`;
        x.shadowColor = P.accent; x.shadowBlur = 22; x.fillText(big, W / 2, H * 0.55); x.shadowBlur = 0;
        x.fillStyle = P.ink; x.font = `600 ${H * 0.1}px ${body}`;
        if (s.kind === "ca") x.fillText(caShort, W / 2, H * 0.8);
        else {
          const txt = `  ${cfg.tagline}  ·  CA: ${caShort}  ·  `;
          x.textAlign = "left"; const tw = x.measureText(txt).width; const off = -((t * 70) % tw);
          for (let o = off; o < W; o += tw) x.fillText(txt, o, H * 0.86);
        }
      } else if (s.kind === "chart") {
        x.fillStyle = "#07090d"; x.fillRect(0, 0, W, H);
        x.strokeStyle = "rgba(255,255,255,0.06)"; for (let i = 0; i < W; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
        for (let j = 0; j < H; j += 32) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); }
        if (frame % 6 === 0) { price += (Math.random() - 0.3) * 7; candles.push(price); candles.shift(); }
        const mn = Math.min(...candles) - 5, mx = Math.max(...candles) + 5, cw = W / candles.length;
        candles.forEach((v, i) => {
          const prev = candles[i - 1] ?? v, up = v >= prev;
          const y0 = H - ((prev - mn) / (mx - mn)) * H * 0.8 - H * 0.1, y1 = H - ((v - mn) / (mx - mn)) * H * 0.8 - H * 0.1;
          x.fillStyle = up ? "#2ee66b" : "#ff4d5e";
          x.fillRect(i * cw + 2, Math.min(y0, y1), cw - 4, Math.max(3, Math.abs(y1 - y0)));
          x.fillRect(i * cw + cw / 2 - 1, Math.min(y0, y1) - 6, 2, Math.abs(y1 - y0) + 12);
        });
        x.fillStyle = P.ink; x.font = `900 ${H * 0.12}px ${display}`; x.fillText(cfg.ticker, 16, H * 0.16);
        x.fillStyle = "#2ee66b"; x.font = `700 ${H * 0.08}px ${body}`; x.fillText("▲ " + (frame % 60 < 30 ? "SEND IT" : "+∞%"), 16, H * 0.27);
      } else if (s.kind === "image" && s.img) {
        const im = img(s.img); x.fillStyle = "#000"; x.fillRect(0, 0, W, H); if (im) { const r = Math.max(W / im.width, H / im.height); x.drawImage(im, (W - im.width * r) / 2, (H - im.height * r) / 2, im.width * r, im.height * r); }
      }
      if (s.crt !== false) {
        x.globalAlpha = 0.12; x.fillStyle = "#000"; for (let yy = (frame % 3); yy < H; yy += 3) x.fillRect(0, yy, W, 1); x.globalAlpha = 1;
        const v = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.55)"); x.fillStyle = v; x.fillRect(0, 0, W, H);
      }
      x.restore();
      tex.needsUpdate = true;
    };
    updaters.push((t, dt) => { acc += dt; if (acc >= 1 / 20) { acc = 0; draw(t); } light.intensity = 0.8 + Math.sin(t * 13) * 0.05; });
  });

  return { interactives, updaters, editables };
}
