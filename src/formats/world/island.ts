import * as THREE from "three";
import type { Surface } from "../../ui/sfx";
import type { OpenTarget, WorldFormat } from "../../types";
import type { Interactive } from "../../core/interactive";
import { glowTexture } from "../../core/textures";

// Procedurell lågpoly-ö: marktextur med stigar, klippig undersida (sky) eller strand + hav (sea),
// himmel, moln, brygga med brevlåda och småsaker på gräset. Allt i kod – inga bildfiler.

export interface Collider { x: number; z: number; r: number }
type Upd = (t: number, dt: number) => void;

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Avstånd från punkt till segment (för att hålla småsaker borta från stigarna). */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l));
  return Math.hypot(px - (ax + dx * k), pz - (az + dz * k));
}

export function buildIsland(W: WorldFormat, scene: THREE.Scene, pathTo: { x: number; z: number }[], colliders: Collider[]) {
  const group = new THREE.Group(); group.name = "island";
  const updaters: Upd[] = [];
  const interactives: Interactive[] = [];
  const R = W.radius;
  const sea = W.kind === "sea";
  const Rout = R + (sea ? 2.6 : 1.1);
  const G = W.ground;
  const r = rng(7);

  // ---------- himmel ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(W.sky.top) }, bottom: { value: new THREE.Color(W.sky.bottom) }, sun: { value: new THREE.Color(W.sky.sun) }, sunDir: { value: new THREE.Vector3(0.45, 0.35, -0.82).normalize() } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: `uniform vec3 top, bottom, sun, sunDir; varying vec3 vP;
      void main(){ float h = clamp(vP.y*1.4+.35, 0., 1.); vec3 c = mix(bottom, top, pow(h, .9));
        float s = max(dot(vP, sunDir), 0.); c += sun * (pow(s, 400.)*1.4 + pow(s, 12.)*.35);
        gl_FragColor = vec4(c, 1.); }`,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), skyMat); skyDome.renderOrder = -10;
  scene.add(skyDome);
  scene.fog = new THREE.Fog(W.sky.bottom, R * 3.2, R * 11);
  scene.background = new THREE.Color(W.sky.bottom);

  // ---------- marktextur (planar UV) ----------
  const TS = 1024, span = Rout * 2;
  const c = document.createElement("canvas"); c.width = c.height = TS;
  const x = c.getContext("2d")!;
  const toPx = (v: number) => (v / span + 0.5) * TS;
  x.fillStyle = G.grass; x.fillRect(0, 0, TS, TS);
  for (let i = 0; i < 260; i++) { // mjuka fläckar
    const px = r() * TS, py = r() * TS, rad = 20 + r() * 70;
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, G.grass2 + "aa"); g.addColorStop(1, G.grass2 + "00"); x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  // kant: sand (sea) eller jordkant (sky)
  const edge = x.createRadialGradient(TS / 2, TS / 2, (R / span) * TS, TS / 2, TS / 2, (Rout / span) * TS);
  edge.addColorStop(0, G.grass + "00"); edge.addColorStop(sea ? 0.18 : 0.55, sea ? G.sand : G.grass2); edge.addColorStop(1, sea ? G.sand : G.rock2);
  x.fillStyle = edge; x.fillRect(0, 0, TS, TS);
  // stigar
  if (W.paths !== false) {
    x.lineCap = "round"; x.lineJoin = "round";
    for (const p of pathTo) {
      for (const [w, col] of [[0.95, G.path + "88"], [0.7, G.path]] as const) {
        x.strokeStyle = col; x.lineWidth = (w / span) * TS; x.beginPath(); x.moveTo(toPx(0), toPx(0));
        const mx = p.x * 0.5 + (r() - 0.5) * 1.2, mz = p.z * 0.5 + (r() - 0.5) * 1.2;
        x.quadraticCurveTo(toPx(mx), toPx(mz), toPx(p.x), toPx(p.z)); x.stroke();
      }
    }
    x.fillStyle = G.path; x.beginPath(); x.arc(toPx(0), toPx(0), (1.3 / span) * TS, 0, 7); x.fill();
  }
  const img = x.getImageData(0, 0, TS, TS); // grain
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 16; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  x.putImageData(img, 0, 0);
  const groundTex = new THREE.CanvasTexture(c); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = 8;

  // ---------- ovansidan: polärt rutnät, platt där man går, facetterad kant ----------
  const rings = 18, segs = 56;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const heightAt = (rr: number, a: number) => {
    const n = Math.sin(a * 5 + 1.3) * 0.5 + Math.sin(a * 11 + 0.4) * 0.3;
    if (rr <= R) return rr / R > 0.85 ? n * 0.05 * ((rr / R - 0.85) / 0.15) : 0;
    const k = (rr - R) / (Rout - R);
    return sea ? -k * k * 0.75 + n * 0.04 : n * 0.08 + Math.sin(k * Math.PI) * 0.12;
  };
  pos.push(0, 0, 0); uv.push(0.5, 0.5);
  for (let i = 1; i <= rings; i++) {
    const rr = (i / rings) * Rout;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2 + (i % 2) * (Math.PI / segs);
      const jit = i < rings ? (r() - 0.5) * 0.18 : 0;
      const px = Math.cos(a) * (rr + jit), pz = Math.sin(a) * (rr + jit);
      pos.push(px, heightAt(rr, a), pz); uv.push(px / span + 0.5, 1 - (pz / span + 0.5));
    }
  }
  const vi = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * segs + (((j % segs) + segs) % segs));
  for (let j = 0; j < segs; j++) idx.push(0, vi(1, j + 1), vi(1, j));
  for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = vi(i, j), b = vi(i, j + 1), cc = vi(i + 1, j), d = vi(i + 1, j + 1);
    if (i % 2) idx.push(a, b, d, a, d, cc); else idx.push(a, b, cc, b, d, cc);
  }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  topGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  topGeo.setIndex(idx); topGeo.computeVertexNormals();
  const top = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, flatShading: true }));
  top.receiveShadow = true; top.name = "ground"; group.add(top);

  // ---------- undersida ----------
  if (!sea) {
    // klippig kon som hänger under ön
    const depth = R * 1.25;
    const cone = new THREE.ConeGeometry(Rout + 0.02, depth, 14, 5, true);
    cone.rotateX(Math.PI); cone.translate(0, -depth / 2 + 0.06, 0);
    const p = cone.attributes.position as THREE.BufferAttribute;
    const col: number[] = [];
    const rock = new THREE.Color(G.rock), rock2 = new THREE.Color(G.rock2), dirt = new THREE.Color(G.rock2).lerp(new THREE.Color(G.grass2), 0.25);
    // samma förskjutning för dubblerade sömvertexar, annars spricker konen
    const jit = new Map<string, [number, number]>();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), k = -y / depth;
      const key = `${Math.round(p.getX(i) * 100)},${Math.round(y * 100)},${Math.round(p.getZ(i) * 100)}`;
      if (!jit.has(key)) jit.set(key, [1 + (r() - 0.5) * 0.28, (r() - 0.5) * 0.5]);
      const [s, dy] = jit.get(key)!;
      if (k > 0.03 && k < 0.98) { p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s); p.setY(i, y + dy); }
      const cc = k < 0.14 ? dirt : rock.clone().lerp(rock2, (Math.sin(y * 3.1) * 0.5 + 0.5) * 0.7);
      col.push(cc.r, cc.g, cc.b);
    }
    cone.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    cone.computeVertexNormals();
    const under = new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    under.castShadow = true; group.add(under);

    // små svävande stenöar runt om
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: G.rock, roughness: 1, flatShading: true });
    const capMat = new THREE.MeshStandardMaterial({ color: G.grass, roughness: 1, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + r() * 0.6, d = Rout + 3 + r() * 5, s = 0.4 + r() * 0.8;
      const g = new THREE.Group();
      const m = new THREE.Mesh(rockGeo, rockMat); m.scale.set(s, s * 1.4, s); m.position.y = -s * 0.9; g.add(m);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.95, s * 0.8, s * 0.3, 7), capMat); g.add(cap);
      g.position.set(Math.cos(a) * d, -1 - r() * 3, Math.sin(a) * d); group.add(g);
      const y0 = g.position.y, ph = r() * 6;
      updaters.push((t) => { g.position.y = y0 + Math.sin(t * 0.6 + ph) * 0.25; g.rotation.y = t * 0.05 + ph; });
    }
    // molnhav långt under
    const cloudMat = new THREE.MeshStandardMaterial({ color: W.water.shallow, roughness: 1, flatShading: true, emissive: W.water.shallow, emissiveIntensity: 0.35 });
    const cloudMat2 = new THREE.MeshStandardMaterial({ color: W.water.deep, roughness: 1, flatShading: true, emissive: W.water.deep, emissiveIntensity: 0.3 });
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const clouds = new THREE.Group();
    // molnhav: tuvor av runda puffar
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2, d = 3 + Math.sqrt(r()) * 55, base = 1.6 + r() * 2.2, mat = r() > 0.35 ? cloudMat : cloudMat2;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = -R * 1.35 - r() * 2.5;
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(puff, mat), s = base * (0.6 + r() * 0.6);
        m.scale.set(s, s * 0.8, s); m.position.set(cx + (r() - 0.5) * base * 2.4, cy + r() * base * 0.5, cz + (r() - 0.5) * base * 2.4);
        clouds.add(m);
      }
    }
    group.add(clouds);
    updaters.push((t) => { clouds.rotation.y = t * 0.006; });
    // moln i ögonhöjd, långt bort
    const high = new THREE.Group();
    const puff2 = new THREE.IcosahedronGeometry(1, 1);
    const hiMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, emissive: "#ffffff", emissiveIntensity: 0.45, fog: false });
    for (let i = 0; i < 12; i++) {
      const cl = new THREE.Group(), a = r() * Math.PI * 2, d = 32 + r() * 26;
      const n = 5 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(puff2, hiMat); const s = 0.9 + r() * 0.9 * (1 - Math.abs(k - n / 2) / n);
        m.scale.set(s, s * 0.85, s); m.position.set((k - n / 2) * 1.1, Math.sin((k / (n - 1)) * Math.PI) * 0.7 + r() * 0.3, (r() - 0.5) * 0.8); cl.add(m);
      }
      cl.scale.setScalar(1.2 + r() * 1.2);
      cl.position.set(Math.cos(a) * d, 2 + r() * 8, Math.sin(a) * d); cl.lookAt(0, cl.position.y, 0); high.add(cl);
    }
    group.add(high);
    updaters.push((t) => { high.rotation.y = -t * 0.01; });
  } else {
    // lågpoly-hav med vågor
    const segsW = 70, size = 220;
    const geo = new THREE.PlaneGeometry(size, size, segsW, segsW); geo.rotateX(-Math.PI / 2);
    const wp = geo.attributes.position as THREE.BufferAttribute;
    const base = Float32Array.from(wp.array as Float32Array);
    const col: number[] = [];
    const sh = new THREE.Color(W.water.shallow), dp = new THREE.Color(W.water.deep);
    for (let i = 0; i < wp.count; i++) {
      const d = Math.hypot(base[i * 3], base[i * 3 + 2]); const k = THREE.MathUtils.smoothstep(d, Rout, Rout + 14);
      const cc = sh.clone().lerp(dp, k); col.push(cc.r, cc.g, cc.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05, flatShading: true, transparent: true, opacity: 0.94 }));
    water.position.y = -0.32; water.receiveShadow = true; group.add(water);
    let acc = 0;
    updaters.push((t, dt) => {
      acc += dt; if (acc < 1 / 24) return; acc = 0;
      for (let i = 0; i < wp.count; i++) {
        const px = base[i * 3], pz = base[i * 3 + 2];
        wp.setY(i, Math.sin(px * 0.35 + t * 1.1) * 0.12 + Math.cos(pz * 0.3 + t * 0.9) * 0.1 + Math.sin((px + pz) * 0.8 + t * 1.7) * 0.04);
      }
      wp.needsUpdate = true; geo.computeVertexNormals();
    });
    // skumring runt stranden
    const foam = new THREE.Mesh(new THREE.RingGeometry(Rout - 0.9, Rout - 0.35, 64), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.y = -0.2; group.add(foam);
    updaters.push((t) => { const k = Math.sin(t * 1.3) * 0.5 + 0.5; foam.scale.setScalar(1 + k * 0.03); (foam.material as THREE.MeshBasicMaterial).opacity = 0.3 + k * 0.35; });
    // botten under ön så man inte ser rakt igenom
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(Rout, Rout + 2, 1.5, 32), new THREE.MeshStandardMaterial({ color: G.sand, roughness: 1 }));
    bed.position.y = -1.3; group.add(bed);
  }

  // ---------- brygga + brevlåda ----------
  let pierRect: { a: number; u0: number; u1: number; hw: number } | null = null;
  if (W.pier) {
    const a = Math.PI / 2 - W.pier.angle, len = sea ? 4.2 : 3.4, hw = 0.62;
    const u0 = R - 0.6, u1 = Rout + len;
    pierRect = { a, u0, u1, hw };
    const pier = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: "#a8703f", roughness: 0.9, flatShading: true });
    const wood2 = new THREE.MeshStandardMaterial({ color: "#8a5a32", roughness: 0.9, flatShading: true });
    const n = Math.round((u1 - u0) / 0.34);
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, hw * 2 + (r() - 0.5) * 0.1), i % 2 ? wood : wood2);
      b.position.set(u0 + i * 0.34 + 0.17, 0.05 + (r() - 0.5) * 0.02, (r() - 0.5) * 0.05); b.rotation.y = (r() - 0.5) * 0.04; b.castShadow = b.receiveShadow = true; pier.add(b);
    }
    for (let u = Rout - 0.2; u < u1; u += 1.3) for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, sea ? 1.4 : 0.9, 6), wood2);
      post.position.set(u, sea ? -0.5 : -0.3, s * (hw - 0.05)); post.castShadow = true; pier.add(post);
    }
    // brevlåda längst ut
    const mb = new THREE.Group();
    const postM = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 0.09), wood2); postM.position.y = 0.45; mb.add(postM);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: "#1c1c22", roughness: 0.5, flatShading: true }));
    box.position.y = 1.02; box.castShadow = true; mb.add(box);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.46, 8, 1, false, 0, Math.PI), box.material); lid.rotation.z = Math.PI / 2; lid.position.y = 1.17; mb.add(lid);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.12), new THREE.MeshStandardMaterial({ color: "#ff4d4d", roughness: 0.6 }));
    flag.position.set(0.26, 1.2, 0.08); mb.add(flag);
    const lc = document.createElement("canvas"); lc.width = lc.height = 128; const lx = lc.getContext("2d")!;
    lx.fillStyle = "#fff"; lx.font = "900 92px system-ui, sans-serif"; lx.textAlign = "center"; lx.textBaseline = "middle"; lx.fillText("𝕏", 64, 70);
    const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
    for (const s of [-1, 1]) { const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: lt, transparent: true })); lbl.position.set(0, 1.02, s * 0.152); lbl.rotation.y = s < 0 ? Math.PI : 0; mb.add(lbl); }
    mb.position.set(u1 - 0.45, 0.08, 0); mb.rotation.y = Math.PI / 2; pier.add(mb);
    updaters.push((t) => { flag.rotation.x = Math.sin(t * 2.4) * 0.15; });
    pier.rotation.y = -a; // lokala +X pekar utåt längs (cos a, sin a)
    group.add(pier);
    if (W.pier.open) interactives.push({ obj: mb, open: W.pier.open as OpenTarget, label: W.pier.label ?? "follow on 𝕏", id: "pier" });
  }

  // ---------- småsaker på gräset ----------
  const free = (px: number, pz: number, pad: number) => {
    if (Math.hypot(px, pz) > R - 0.4) return false;
    for (const cl of colliders) if (Math.hypot(px - cl.x, pz - cl.z) < cl.r + pad) return false;
    if (W.paths !== false) for (const p of pathTo) if (segDist(px, pz, 0, 0, p.x, p.z) < 0.75) return false;
    if (Math.hypot(px - W.spawn[0], pz - W.spawn[2]) < 1.8) return false;
    return Math.hypot(px, pz) > 1.6;
  };
  const place = (n: number, pad: number) => {
    const out: [number, number][] = [];
    for (let k = 0; k < n * 8 && out.length < n; k++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R; const px = Math.cos(a) * d, pz = Math.sin(a) * d; if (free(px, pz, pad)) out.push([px, pz]); }
    return out;
  };
  const dm = new THREE.Object3D();
  const D = W.decor ?? {};
  const tufts = place(D.tufts ?? 120, 0.2);
  if (tufts.length) {
    const im = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.3, 4), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), tufts.length * 3);
    const g1 = new THREE.Color(G.grass).multiplyScalar(0.85), g2 = new THREE.Color(G.grass2);
    tufts.forEach(([px, pz], i) => { for (let k = 0; k < 3; k++) {
      dm.position.set(px + (r() - 0.5) * 0.14, 0.12, pz + (r() - 0.5) * 0.14); dm.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5); dm.scale.setScalar(0.7 + r() * 0.6); dm.updateMatrix();
      im.setMatrixAt(i * 3 + k, dm.matrix); im.setColorAt(i * 3 + k, g1.clone().lerp(g2, r()));
    } });
    im.receiveShadow = true; group.add(im);
  }
  const flowers = D.flowers?.length ? place(60, 0.25) : [];
  if (flowers.length) {
    const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.075, 0), new THREE.MeshStandardMaterial({ roughness: 0.7, flatShading: true }), flowers.length);
    const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 4), new THREE.MeshStandardMaterial({ color: G.grass2 }), flowers.length);
    flowers.forEach(([px, pz], i) => {
      dm.rotation.set(0, 0, 0); dm.scale.set(1, 0.7, 1); dm.position.set(px, 0.2, pz); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
      im.setColorAt(i, new THREE.Color(D.flowers![i % D.flowers!.length]));
      dm.scale.set(1, 1, 1); dm.position.set(px, 0.1, pz); dm.updateMatrix(); stem.setMatrixAt(i, dm.matrix);
    });
    group.add(stem, im);
  }
  const rocks = place(D.rocks ?? 10, 0.4);
  if (rocks.length) {
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: G.rock, roughness: 1, flatShading: true }), rocks.length);
    rocks.forEach(([px, pz], i) => { dm.position.set(px, 0.05, pz); dm.rotation.set(r(), r() * 3, r()); const s = 0.6 + r() * 1.2; dm.scale.set(s, s * 0.6, s); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); });
    im.castShadow = im.receiveShadow = true; group.add(im);
    rocks.forEach(([px, pz]) => colliders.push({ x: px, z: pz, r: 0.25 }));
  }

  scene.add(group);
  group.updateMatrixWorld(true);

  const halo = (color: string, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.scale.setScalar(size); return s;
  };

  /** Får man stå här? Inuti ön eller på bryggan. */
  const walkable = (px: number, pz: number) => {
    if (Math.hypot(px, pz) < R - 0.15) return true;
    if (!pierRect) return false;
    const ca = Math.cos(pierRect.a), sa = Math.sin(pierRect.a);
    const u = px * ca + pz * sa, v = -px * sa + pz * ca;
    return u > pierRect.u0 && u < pierRect.u1 - 0.9 && Math.abs(v) < pierRect.hw - 0.2;
  };
  const pierEnd = pierRect ? { x: Math.cos(pierRect.a) * (pierRect.u1 - 1.2), z: Math.sin(pierRect.a) * (pierRect.u1 - 1.2) } : null;

  /** Underlag under en punkt (för fotstegsljud): brygga = trä, annars närmaste färg i marktexturen. */
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const refs: [Surface, number[]][] = [["path", rgb(G.path)], ["grass", rgb(G.grass)], ["grass", rgb(G.grass2)], ...(sea ? [["sand", rgb(G.sand)] as [Surface, number[]]] : [])];
  const surface = (px: number, pz: number): Surface => {
    if (Math.hypot(px, pz) > R - 0.15) return pierRect ? "wood" : "grass";
    const ix = Math.min(TS - 1, Math.max(0, Math.floor(toPx(px)))), iz = Math.min(TS - 1, Math.max(0, Math.floor(toPx(pz))));
    const o = (iz * TS + ix) * 4, p = [img.data[o], img.data[o + 1], img.data[o + 2]];
    let best: Surface = "grass", bd = 1e9;
    for (const [k, c] of refs) { const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
    return best;
  };

  return { group, ground: top, updaters, interactives, halo, walkable, surface, pierEnd, Rout, skyDome };
}
