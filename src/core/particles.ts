import * as THREE from "three";
import type { ParticleKind } from "../types";
import { isMobile, rand } from "./util";

function spriteTex(kind: ParticleKind, color: string) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d")!; x.translate(32, 32);
  if (kind === "petals") {
    const g = x.createRadialGradient(0, -4, 2, 0, 0, 26); g.addColorStop(0, "#fff"); g.addColorStop(1, color);
    x.fillStyle = g; x.beginPath(); x.moveTo(0, -22); x.bezierCurveTo(16, -16, 16, 10, 0, 20); x.bezierCurveTo(-4, 12, -4, 12, 0, 8); x.bezierCurveTo(-16, 10, -16, -16, 0, -22); x.fill();
  } else if (kind === "money") {
    x.fillStyle = color; x.fillRect(-28, -14, 56, 28); x.strokeStyle = "rgba(0,0,0,.35)"; x.lineWidth = 3; x.strokeRect(-24, -10, 48, 20);
    x.fillStyle = "rgba(0,0,0,.35)"; x.beginPath(); x.arc(0, 0, 7, 0, 7); x.fill();
  } else if (kind === "bubbles") {
    x.strokeStyle = color; x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 24, 0, 7); x.stroke(); x.fillStyle = "rgba(255,255,255,.5)"; x.beginPath(); x.arc(-9, -9, 6, 0, 7); x.fill();
  } else {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 30); g.addColorStop(0, "#fff"); g.addColorStop(0.25, color); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(-32, -32, 64, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Stämningspartiklar i hela rummet. Plan (instansierade) för kronblad/sedlar, punkter för damm/snö/glöd. */
export function buildAmbient(kind: ParticleKind, count: number, color: string, W: number, D: number, H: number) {
  const n = Math.round(count * (isMobile ? 0.5 : 1));
  const planes = kind === "petals" || kind === "money";
  const area = { x: W, y: H, z: D };
  const data = Array.from({ length: n }, () => ({
    x: rand(-area.x / 2, area.x / 2), y: rand(0, area.y * 1.2), z: rand(-area.z / 2, area.z / 2),
    vy: kind === "embers" || kind === "bubbles" ? rand(0.2, 0.6) : kind === "dust" || kind === "stars" ? rand(-0.03, 0.03) : -rand(0.35, 0.9),
    ph: rand(0, 7), sp: rand(0.5, 1.6), r: rand(0, 7), s: rand(0.6, 1.3),
  }));
  const tex = spriteTex(kind, color);
  let obj: THREE.Object3D;
  let update: (t: number, dt: number) => void;

  if (planes) {
    const size = kind === "money" ? 0.22 : 0.14;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 });
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(size, kind === "money" ? size * 0.5 : size), mat, n);
    mesh.frustumCulled = false; obj = mesh;
    const d = new THREE.Object3D();
    update = (t, dt) => {
      data.forEach((p, i) => {
        p.y += p.vy * dt; p.x += Math.sin(t * p.sp + p.ph) * 0.3 * dt; p.r += dt * p.sp;
        if (p.y < -0.2) { p.y = area.y * 1.2; p.x = rand(-area.x / 2, area.x / 2); p.z = rand(-area.z / 2, area.z / 2); }
        d.position.set(p.x, p.y, p.z); d.rotation.set(p.r, p.r * 0.7, p.r * 0.3); d.scale.setScalar(p.s); d.updateMatrix(); mesh.setMatrixAt(i, d.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
  } else {
    const pos = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: tex, size: kind === "dust" ? 0.05 : kind === "stars" ? 0.08 : 0.09, transparent: true, depthWrite: false, blending: kind === "bubbles" ? THREE.NormalBlending : THREE.AdditiveBlending, sizeAttenuation: true, opacity: kind === "dust" ? 0.55 : 0.9 });
    obj = new THREE.Points(g, mat); obj.frustumCulled = false;
    update = (t, dt) => {
      data.forEach((p, i) => {
        p.y += p.vy * dt; p.x += Math.sin(t * p.sp * 0.5 + p.ph) * 0.05 * dt; p.z += Math.cos(t * p.sp * 0.4 + p.ph) * 0.05 * dt;
        if (p.y > area.y * 1.2) p.y = 0; if (p.y < 0) p.y = area.y * 1.2;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      });
      g.attributes.position.needsUpdate = true;
      if (kind === "stars" || kind === "dust") mat.opacity = (kind === "dust" ? 0.45 : 0.8) + Math.sin(t * 1.3) * 0.1;
    };
  }
  return { obj, update };
}

/** Konfetti-/myntburst när man klickar på karaktären. */
export function buildBurst(colors: string[]) {
  const N = 90;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const vel = Array.from({ length: N }, () => new THREE.Vector3());
  const life = new Float32Array(N).fill(-1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, depthWrite: false, map: spriteTex("dust", "#ffffff"), blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  const palette = colors.map((c) => new THREE.Color(c));
  let next = 0;
  function fire(at: THREE.Vector3, amount = 36) {
    for (let k = 0; k < amount; k++) {
      const i = next++ % N;
      pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
      vel[i].set(rand(-1, 1), rand(1.5, 3.4), rand(-1, 1));
      life[i] = 1.2;
      const c = palette[k % palette.length]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
  }
  function update(_t: number, dt: number) {
    for (let i = 0; i < N; i++) {
      if (life[i] < 0) { pos[i * 3 + 1] = -99; continue; }
      life[i] -= dt; vel[i].y -= 6 * dt;
      pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt;
      if (pos[i * 3 + 1] < 0.02) { pos[i * 3 + 1] = 0.02; vel[i].y *= -0.35; vel[i].x *= 0.7; vel[i].z *= 0.7; }
    }
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
  return { obj: pts, fire, update };
}
