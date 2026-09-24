import * as THREE from "three";
import type { DecorConfig, OpenTarget, SiteConfig } from "../../types";
import { floorTexture, wallTexture, rugTexture, skyTexture, glowTexture, shaftTexture, neonTexture, shade } from "../../core/textures";
import { isMobile } from "../../core/util";

export type { Interactive } from "../../core/interactive";
import type { Interactive } from "../../core/interactive";

type Wall = "back" | "left" | "right";
const WALL_T = 0.25;

export function buildRoom(cfg: SiteConfig, scene: THREE.Scene, texLoader: THREE.TextureLoader) {
  const R = cfg.room!;
  const W = R.width, D = R.depth, H = R.height;
  const group = new THREE.Group(); group.name = "room";
  const interactives: Interactive[] = [];
  const updaters: ((t: number, dt: number) => void)[] = [];
  const editables: { id: string; obj: THREE.Object3D }[] = [];

  // ---------- bakgrund ----------
  scene.background = new THREE.Color(cfg.palette.bg);
  scene.fog = new THREE.Fog(cfg.palette.fog, Math.max(W, D) * 2.2, Math.max(W, D) * 6);
  if (R.backdrop.kind !== "void") {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(R.backdrop.top) }, bottom: { value: new THREE.Color(R.backdrop.bottom) } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP;\nvoid main(){ float h = smoothstep(-0.4, 0.8, vP.y); gl_FragColor = vec4(mix(bottom, top, h), 1.);\n#include <colorspace_fragment>\n}",
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 16), skyMat);
    sky.renderOrder = -10; group.add(sky);
  }
  if (R.backdrop.kind === "stars") {
    const N = isMobile ? 900 : 2200, p = new Float32Array(N * 3), sz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random(), v = Math.random(), th = 2 * Math.PI * u, ph = Math.acos(2 * v - 1), r = 60 + Math.random() * 10;
      p[i * 3] = r * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.9 - 8; p[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      sz[i] = Math.random();
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("seed", new THREE.BufferAttribute(sz, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: "attribute float seed; varying float vA; uniform float uTime; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = (1.2+seed*2.6); vA = 0.45+0.55*sin(uTime*(0.6+seed*2.)+seed*40.); }",
      fragmentShader: "varying float vA; void main(){ float d = length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor = vec4(vec3(1.), vA*(1.-d*2.)); }",
    });
    const stars = new THREE.Points(g, mat); group.add(stars);
    updaters.push((t) => { mat.uniforms.uTime.value = t; stars.rotation.y = t * 0.004; });
  }

  // ---------- golv + väggar ----------
  const floorTex = floorTexture(R.floor.kind, R.floor.a, R.floor.b, 1);
  floorTex.repeat.set((W / 4) * (R.floor.repeat ?? 1.5), (D / 4) * (R.floor.repeat ?? 1.5));
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: R.floor.kind === "checker" || R.floor.kind === "tile" ? 0.32 : 0.8, metalness: 0.02 });
  const sideMat = new THREE.MeshStandardMaterial({ color: shade(R.walls.trim ?? R.floor.b, -0.18), roughness: 0.9 });
  const SLAB = 0.45;

  if (R.shape === "floating") {
    const rad = Math.max(W, D) / 2;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 0.94, SLAB, 64), [sideMat, floorMat, sideMat]);
    top.position.y = -SLAB / 2; top.receiveShadow = true; group.add(top);
  } else {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + WALL_T, SLAB, D + WALL_T), [sideMat, sideMat, floorMat, sideMat, sideMat, sideMat]);
    slab.position.set(R.shape === "corner-right" ? WALL_T / 2 : -WALL_T / 2, -SLAB / 2, -WALL_T / 2);
    slab.receiveShadow = true; group.add(slab);
    // golvtexturen ska inte sträckas över väggtjockleken
    (floorTex as THREE.Texture).repeat.set((W / 4) * (R.floor.repeat ?? 1.5), (D / 4) * (R.floor.repeat ?? 1.5));

    const wt = wallTexture(R.walls.kind, R.walls.a, R.walls.b);
    const mkWallMat = (len: number) => { const t = wt.clone(); t.needsUpdate = true; t.repeat.set(len / 2.6, H / 2.6); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }); };
    const capMat = new THREE.MeshStandardMaterial({ color: shade(R.walls.trim ?? R.walls.b, -0.1), roughness: 0.7 });
    const trimMat = new THREE.MeshStandardMaterial({ color: R.walls.trim ?? shade(R.walls.a, -0.25), roughness: 0.6 });

    const back = new THREE.Mesh(new THREE.BoxGeometry(W + WALL_T, H, WALL_T), [capMat, capMat, capMat, capMat, mkWallMat(W), capMat]);
    back.position.set(R.shape === "corner-right" ? WALL_T / 2 : -WALL_T / 2, H / 2, -D / 2 - WALL_T / 2);
    back.receiveShadow = true; back.castShadow = true; group.add(back);
    const sideX = R.shape === "corner-right" ? W / 2 + WALL_T / 2 : -W / 2 - WALL_T / 2;
    const sideFace = R.shape === "corner-right" ? 1 : 0; // BoxGeometry-grupper: 0=+x 1=-x
    const sideMats = [capMat, capMat, capMat, capMat, capMat, capMat]; sideMats[sideFace] = mkWallMat(D);
    const side = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, H, D), sideMats);
    side.position.set(sideX, H / 2, 0); side.receiveShadow = true; side.castShadow = true; group.add(side);

    // sockel
    const bb1 = new THREE.Mesh(new THREE.BoxGeometry(W, 0.16, 0.05), trimMat); bb1.position.set(0, 0.08, -D / 2 + 0.025); group.add(bb1);
    const bb2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, D), trimMat); bb2.position.set(R.shape === "corner-right" ? W / 2 - 0.025 : -W / 2 + 0.025, 0.08, 0); group.add(bb2);
    // taklist
    const cr1 = new THREE.Mesh(new THREE.BoxGeometry(W, 0.1, 0.08), trimMat); cr1.position.set(0, H - 0.05, -D / 2 + 0.04); group.add(cr1);
    const cr2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, D), trimMat); cr2.position.set(R.shape === "corner-right" ? W / 2 - 0.04 : -W / 2 + 0.04, H - 0.05, 0); group.add(cr2);
  }

  // ---------- ljus ----------
  const L = R.lights;
  const hemi = new THREE.HemisphereLight(0xffffff, new THREE.Color(R.floor.a).multiplyScalar(0.6), L.ambient);
  group.add(hemi);
  const key = new THREE.DirectionalLight(L.key, L.keyIntensity);
  key.position.set(...L.keyPos); key.castShadow = true;
  const sm = isMobile ? 1024 : 2048;
  key.shadow.mapSize.set(sm, sm);
  const ext = Math.max(W, D) * 0.75;
  Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: 40 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  group.add(key); group.add(key.target);
  const rim = new THREE.DirectionalLight(L.rim, L.rimIntensity);
  rim.position.set(-L.keyPos[0], L.keyPos[1] * 0.6, -Math.abs(L.keyPos[2]) - 4); group.add(rim);
  for (const p of L.practical ?? []) {
    const pl = new THREE.PointLight(p.color, p.intensity, 9, 1.6); pl.position.set(...p.pos); group.add(pl);
  }

  // ---------- dekor ----------
  const wallPlace = (wall: Wall, u: number, v: number) => {
    const eps = 0.02;
    if (wall === "back") return { pos: new THREE.Vector3(-W / 2 + u * W, v * H, -D / 2 + eps), rotY: 0, normal: new THREE.Vector3(0, 0, 1) };
    if (wall === "left") return { pos: new THREE.Vector3(-W / 2 + eps, v * H, -D / 2 + u * D), rotY: Math.PI / 2, normal: new THREE.Vector3(1, 0, 0) };
    return { pos: new THREE.Vector3(W / 2 - eps, v * H, -D / 2 + u * D), rotY: -Math.PI / 2, normal: new THREE.Vector3(-1, 0, 0) };
  };

  R.decor.forEach((d: DecorConfig, i) => {
    const id = `decor:${i}:${d.type}`;
    if (d.type === "frame") {
      const { pos, rotY, normal } = wallPlace(d.wall, d.u, d.v);
      const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = rotY;
      const fm = new THREE.MeshStandardMaterial({ color: d.frame ?? "#2a1d12", roughness: 0.5, metalness: 0.2 });
      const fr = new THREE.Mesh(new THREE.BoxGeometry(d.w + 0.14, d.h + 0.14, 0.06), fm); fr.position.z = 0.03; fr.castShadow = true; g.add(fr);
      const t = texLoader.load(d.img); t.colorSpace = THREE.SRGBColorSpace;
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, emissive: "#ffffff", emissiveMap: t, emissiveIntensity: 0.18 }));
      pic.position.z = 0.065; g.add(pic);
      group.add(g); editables.push({ id, obj: g });
      if (d.open || d.label) interactives.push({ obj: g, open: d.open, label: d.label, normal, id });
    } else if (d.type === "neon") {
      const { pos, rotY, normal } = wallPlace(d.wall, d.u, d.v);
      const { tex, aspect } = neonTexture(d.text, d.color, d.font ?? `"${cfg.fonts.display}", sans-serif`);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(d.size * aspect, d.size), mat);
      m.position.copy(pos); m.rotation.y = rotY; m.position.addScaledVector(normal, 0.03);
      group.add(m); editables.push({ id, obj: m });
      const pl = new THREE.PointLight(d.color, 2.2, 5, 1.8); pl.position.copy(pos).addScaledVector(normal, 0.6); group.add(pl);
      let next = 0;
      updaters.push((t) => {
        if (t > next) { next = t + 2 + Math.random() * 6; }
        const flick = t > next - 0.18 && Math.sin(t * 90) > 0 ? 0.35 : 1;
        mat.color.setScalar(1.6 * flick); pl.intensity = 2.2 * flick;
      });
      if (d.open || d.label) interactives.push({ obj: m, open: d.open, label: d.label, normal, id });
    } else if (d.type === "window") {
      const { pos, rotY, normal } = wallPlace(d.wall, d.u, d.v);
      const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = rotY;
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), new THREE.MeshBasicMaterial({ map: skyTexture(d.sky), toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) }));
      sky.position.z = 0.01; g.add(sky);
      const fm = new THREE.MeshStandardMaterial({ color: R.walls.trim ?? "#f3eee2", roughness: 0.5 });
      const bar = (w: number, h: number, x: number, y: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), fm); b.position.set(x, y, 0.05); b.castShadow = true; g.add(b); };
      bar(d.w + 0.2, 0.1, 0, d.h / 2 + 0.05); bar(d.w + 0.2, 0.14, 0, -d.h / 2 - 0.07); bar(0.1, d.h, -d.w / 2 - 0.05, 0); bar(0.1, d.h, d.w / 2 + 0.05, 0);
      bar(0.06, d.h, 0, 0); bar(d.w, 0.06, 0, 0);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(d.w + 0.4, 0.06, 0.3), fm); sill.position.set(0, -d.h / 2 - 0.14, 0.15); g.add(sill);
      group.add(g); editables.push({ id, obj: g });
      const skyCol = d.sky === "sunset" ? "#ffb38a" : d.sky === "day" ? "#cfe8ff" : "#7aa2ff";
      const wl = new THREE.PointLight(skyCol, 3, 7, 1.5); wl.position.copy(pos).addScaledVector(normal, 1); group.add(wl);
      if (d.shaft) {
        const sm2 = new THREE.MeshBasicMaterial({ map: shaftTexture(), color: skyCol, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
        const shaft = new THREE.Mesh(new THREE.PlaneGeometry(d.w * 1.1, H * 1.1), sm2);
        shaft.position.copy(pos).addScaledVector(normal, H * 0.42); shaft.position.y = pos.y - H * 0.25;
        shaft.rotation.y = rotY; shaft.rotateX(-0.85); group.add(shaft);
        updaters.push((t) => { sm2.opacity = 0.18 + Math.sin(t * 0.7) * 0.04; });
      }
    } else if (d.type === "rug") {
      const m = new THREE.Mesh(d.round ? new THREE.CircleGeometry(d.w / 2, 48) : new THREE.PlaneGeometry(d.w, d.d), new THREE.MeshStandardMaterial({ map: rugTexture(d.color, d.color2, !!d.round), roughness: 1 }));
      m.rotation.x = -Math.PI / 2; m.position.set(d.pos[0], 0.012, d.pos[2]); m.receiveShadow = true; group.add(m); editables.push({ id, obj: m });
    } else if (d.type === "shelf") {
      const { pos, rotY } = wallPlace(d.wall, d.u, d.v);
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, 0.07, 0.34), new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.6 }));
      m.position.copy(pos); m.rotation.y = rotY; m.translateZ(0.17); m.castShadow = true; m.receiveShadow = true; group.add(m); editables.push({ id, obj: m });
    } else if (d.type === "lamp") {
      const g = new THREE.Group(); g.position.set(...d.pos);
      const metal = new THREE.MeshStandardMaterial({ color: "#222", roughness: 0.4, metalness: 0.6 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 24), metal); base.position.y = 0.025; g.add(base);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 8), metal); pole.position.y = 0.9; g.add(pole);
      const shadeM = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.38, 24, 1, true), new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.9, side: THREE.DoubleSide, roughness: 0.8 }));
      shadeM.position.y = 1.85; g.add(shadeM);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(d.color).multiplyScalar(3), toneMapped: false })); bulb.position.y = 1.78; g.add(bulb);
      const pl = new THREE.PointLight(d.color, d.intensity, 6, 1.6); pl.position.y = 1.7; g.add(pl);
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      group.add(g); editables.push({ id, obj: g });
    }
  });

  // halo-sprite helper (används av props med glow)
  const halo = (color: string, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    s.scale.setScalar(size); return s;
  };

  scene.add(group);
  return { group, key, interactives, updaters, editables, halo, bounds: { W, D, H } };
}
