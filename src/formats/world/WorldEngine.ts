import * as THREE from "three";
import type { OpenTarget, SiteConfig } from "../../types";
import type { Interactive } from "../../core/interactive";
import { buildProps } from "../../core/props";
import { buildCharacter } from "../../core/character";
import { buildAmbient, buildBurst } from "../../core/particles";
import { buildPost } from "../../core/post";
import { makeLoader, Tweens, ease, isMobile, worldBox } from "../../core/util";
import { buildScreens } from "../room/screens";
import { buildIsland, type Collider } from "./island";
import { footstep } from "../../ui/sfx";

export interface WorldEvents {
  onProgress: (p: number) => void;
  onOpen: (t: OpenTarget) => void;
  onSfx: (k: "hover" | "click" | "whoosh" | "pop") => void;
  /** Karaktären står vid en plats (eller har gått därifrån). */
  onNear: (p: { label: string; open: OpenTarget } | null) => void;
}
export interface WorldOverlay { bubble: HTMLElement; pins: HTMLElement; minimap: HTMLCanvasElement; marker: HTMLElement }

interface Place { id: string; label: string; open: OpenTarget; obj: THREE.Object3D; spot: THREE.Vector3; top: THREE.Vector3; pin: HTMLElement; face: THREE.Vector3 }
type Upd = (t: number, dt: number) => void;

const lerpAngle = (a: number, b: number, k: number) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };

/**
 * Format "world": karaktären går runt på en liten ö. Kameran följer bakifrån-ovanför och kan vridas.
 * WASD/pilar = gå, klick/tap på marken = gå dit, klick på en plats = gå dit och öppna den, E = öppna platsen man står vid.
 */
export class WorldEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private post!: ReturnType<typeof buildPost>;
  private tweens = new Tweens();
  private clock = new THREE.Clock();
  private updaters: Upd[] = [];
  private interactives: Interactive[] = [];
  private colliders: Collider[] = [];
  private places: Place[] = [];
  private char!: Awaited<ReturnType<typeof buildCharacter>>;
  private burst = buildBurst([]);
  private island!: ReturnType<typeof buildIsland>;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private keys = new Set<string>();
  private target: THREE.Vector3 | null = null;
  private goal: Place | null = null;
  private near: Place | null = null;
  private nearKey = "";
  private waypoints: THREE.Vector3[] = [];
  private running = false;
  private moveClip: string | undefined;
  private feet: { b: THREE.Object3D; lo: number; hi: number; up: boolean; n: number }[] | null = null;
  private stepPhase = 0;
  private tmpV = new THREE.Vector3();
  private walking = false;
  private stuck = 0;
  private idleFor = 0;
  private entered = false;
  private enterK = 0;
  private panelOpen = false;
  private hovered: Interactive | null = null;
  private highlight = new Map<THREE.Material, { e: THREE.Color; i: number }>();
  // kamera
  private az = 0;
  private azGoal = 0;
  private zoom = 1;
  private focus = new THREE.Vector3();
  private drag: { x: number; y: number; az: number; moved: boolean; id: number } | null = null;
  private bubbleUntil = 0;
  private nextQuip = 0;
  private charH = 1;
  private charR = 0.3;
  private disposers: (() => void)[] = [];
  private mmAcc = 0;
  readonly pixelRatio: number;

  constructor(private el: HTMLElement, private cfg: SiteConfig, private overlay: WorldOverlay, private ev: WorldEvents) {
    const W = cfg.world!;
    this.pixelRatio = Math.min(devicePixelRatio, isMobile ? 1.25 : 1.75);
    this.renderer = new THREE.WebGLRenderer({ antialias: !cfg.post.pixelate, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(W.camera.fov + (isMobile ? 10 : 0), innerWidth / innerHeight, 0.1, 400);
    this.camera.position.set(0, W.radius * 1.4, W.radius * 2.6);
    this.camera.lookAt(0, 0, 0);
    this.post = buildPost(this.renderer, this.scene, this.camera, cfg.post, this.pixelRatio);
    this.bindInput();
  }

  async load() {
    const cfg = this.cfg, W = cfg.world!;
    const manager = new THREE.LoadingManager();
    const expected = 1 + cfg.props.length + (cfg.character.clips?.length ?? 0);
    let done = 0;
    const loadGLB = makeLoader(manager);
    const load = async (u: string) => { const r = await loadGLB(u); done++; this.ev.onProgress(Math.min(0.97, done / expected)); return r; };

    // props utan rotY vänds mot öns mitt
    const props = cfg.props.map((p) => (p.rotY === undefined ? { ...p, rotY: Math.atan2(-p.pos[0], -p.pos[2]) } : p));

    // ljus
    const L = W.lights;
    this.scene.add(new THREE.HemisphereLight(W.sky.top, L.ground, L.ambient));
    const sun = new THREE.DirectionalLight(L.sun, L.sunIntensity);
    const R = W.radius;
    sun.position.set(R * 0.9, R * 1.8, R * 1.3); sun.castShadow = true;
    const sc = sun.shadow.camera; sc.left = sc.bottom = -(R + 4); sc.right = sc.top = R + 4; sc.near = 1; sc.far = R * 6;
    sun.shadow.mapSize.setScalar(isMobile ? 1024 : 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    // fyllnadsljus underifrån så öns undersida/klippor inte blir svarta
    const fill = new THREE.DirectionalLight(W.water.shallow, 1.4); fill.position.set(-R * 0.4, -R * 2, R * 1.2); this.scene.add(fill);

    const [pr, char] = await Promise.all([
      buildProps(props, load, this.scene, () => new THREE.Sprite()),
      buildCharacter({ ...cfg.character, pos: W.spawn, rotY: 0, headTrack: false, spotlight: undefined }, load, this.scene, new THREE.Vector3(0, 0, 10)),
    ]);
    this.char = char;
    this.updaters.push(...pr.updaters);
    this.charH = cfg.character.height;
    this.charR = Math.max(0.22, this.charH * 0.22);

    // kolliderare + platser
    const pathTo: { x: number; z: number }[] = [];
    for (const p of props) {
      const obj = pr.byId.get(p.id); if (!obj) continue;
      const b = worldBox(obj), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const rad = Math.max(0.3, Math.min(s.x, s.z) * 0.5 + Math.abs(s.x - s.z) * 0.15);
      this.colliders.push({ x: c.x, z: c.z, r: rad });
      if (!p.open) continue;
      const fwd = new THREE.Vector3(Math.sin(p.rotY ?? 0), 0, Math.cos(p.rotY ?? 0));
      const spot = c.clone().setY(0).addScaledVector(fwd, rad + this.charR + 0.45);
      const pin = document.createElement("div"); pin.className = "w-pin"; pin.innerHTML = `<b>${p.label ?? p.open}</b>`;
      this.overlay.pins.appendChild(pin);
      const place: Place = { id: p.id, label: p.label ?? String(p.open), open: p.open, obj, spot, top: new THREE.Vector3(c.x, b.max.y + 0.35, c.z), pin, face: c.clone().setY(0) };
      pin.onclick = () => { this.ev.onSfx("click"); this.walkTo(place); };
      this.places.push(place);
      pathTo.push({ x: spot.x, z: spot.z });
    }

    this.island = buildIsland(W, this.scene, pathTo, this.colliders);
    this.updaters.push(...this.island.updaters);
    // brevlådan på bryggan blir också en plats
    const pierHs = this.island.interactives[0];
    if (pierHs && this.island.pierEnd) {
      const e = this.island.pierEnd, b = worldBox(pierHs.obj);
      const pin = document.createElement("div"); pin.className = "w-pin"; pin.innerHTML = `<b>${pierHs.label}</b>`;
      this.overlay.pins.appendChild(pin);
      const place: Place = { id: "pier", label: pierHs.label!, open: pierHs.open!, obj: pierHs.obj, spot: new THREE.Vector3(e.x, 0, e.z), top: new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.3, (b.min.z + b.max.z) / 2), pin, face: b.getCenter(new THREE.Vector3()).setY(0) };
      pin.onclick = () => { this.ev.onSfx("click"); this.walkTo(place); };
      this.places.push(place);
    }

    if (W.screens?.length) {
      const scr = buildScreens(cfg, this.scene, pr.byId, W.screens);
      this.updaters.push(...scr.updaters);
    }
    if (W.particles) {
      const amb = buildAmbient(W.particles.kind, W.particles.count, W.particles.color, R * 2, R * 2, 5);
      this.scene.add(amb.obj); this.updaters.push(amb.update);
    }
    this.burst = buildBurst([cfg.palette.accent, cfg.palette.accent2, "#ffffff"]);
    this.scene.add(this.burst.obj); this.updaters.push(this.burst.update);

    // klickbart: platser (osynliga träffboxar), karaktären
    for (const pl of this.places) {
      const b = worldBox(pl.obj), s = b.getSize(new THREE.Vector3());
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(s.x * 1.05, s.y * 1.02, s.z * 1.05), new THREE.MeshBasicMaterial({ visible: false }));
      b.getCenter(proxy.position); this.scene.add(proxy);
      this.interactives.push({ obj: pl.obj, hit: proxy, label: pl.label, open: pl.open, id: pl.id, onClick: () => this.walkTo(pl) });
    }
    this.interactives.push({ obj: char.root, label: cfg.character.label, id: "character", onClick: () => this.poke() });

    this.focus.copy(char.root.position);
    this.renderer.compile(this.scene, this.camera);
    this.ev.onProgress(1);
    this.renderer.setAnimationLoop(() => this.frame());
    if (import.meta.env.DEV) (window as unknown as { memeroom: WorldEngine }).memeroom = this;
  }

  enter() {
    if (this.entered) return; this.entered = true;
    this.tweens.add(2600, (k) => { this.enterK = k; }, () => { this.nextQuip = this.clock.elapsedTime + 1.5; }, ease.inOutCubic);
  }

  /** Dockan/skalet: gå (springa) till platsen och öppna den. */
  open(t: OpenTarget) {
    if (t.startsWith("link:") && !this.places.some((p) => p.open === t)) { this.ev.onOpen(t); return; }
    const pl = this.places.find((p) => p.open === t);
    if (!pl) { this.panelOpen = true; this.ev.onOpen(t); return; }
    this.walkTo(pl, true);
  }

  closePanel() { this.panelOpen = false; }

  /** Öppna platsen man står vid (E / knappen). */
  openNear() { if (this.near) this.arrive(this.near); }

  walkTo(pl: Place, run = false) {
    if (!this.entered) return;
    this.panelOpen = false;
    if (this.char.root.position.distanceTo(pl.spot) < 0.5) { this.arrive(pl); return; }
    this.waypoints = [];
    const pe = this.island.pierEnd;
    if (pl.id === "pier" && pe && Math.hypot(this.char.root.position.x, this.char.root.position.z) < this.cfg.world!.radius - 0.8) {
      // gå först till bryggans början så man inte fastnar mot kanten
      const l = Math.hypot(pe.x, pe.z), k = (this.cfg.world!.radius - 1.2) / l;
      this.waypoints.push(pl.spot.clone());
      this.target = new THREE.Vector3(pe.x * k, 0, pe.z * k);
    } else this.target = pl.spot.clone();
    this.goal = pl; this.running = run || this.char.root.position.distanceTo(pl.spot) > this.cfg.world!.radius * 0.9;
    this.ev.onSfx("whoosh");
  }

  private arrive(pl: Place) {
    this.target = null; this.goal = null;
    this.char.st.yaw = Math.atan2(pl.face.x - this.char.root.position.x, pl.face.z - this.char.root.position.z);
    this.faceLock = 0.9;
    this.panelOpen = !pl.open.startsWith("link:");
    this.ev.onOpen(pl.open);
  }
  private faceLock = 0;

  poke() {
    if (this.walking) return;
    this.char.react(); this.say();
    this.burst.fire(this.char.headWorld()); this.ev.onSfx("pop");
  }

  say(text?: string) {
    const q = this.cfg.character.quotes; if (!q.length) return;
    this.overlay.bubble.textContent = text ?? q[Math.floor(Math.random() * q.length)];
    this.overlay.bubble.classList.add("show");
    this.bubbleUntil = this.clock.elapsedTime + 3.6;
    this.nextQuip = this.clock.elapsedTime + 12 + Math.random() * 8;
  }

  private bindInput() {
    const dom = this.renderer.domElement;
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
        if (down) { this.keys.add(k); this.target = null; this.goal = null; this.waypoints = []; } else this.keys.delete(k);
        if (k.startsWith("arrow")) e.preventDefault();
      }
      if (down && (k === "e" || k === "enter") && this.near && !this.panelOpen) this.openNear();
      if (down && k === "q") this.azGoal += 0.6;
    };
    const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => this.keys.clear();
    const down = (e: PointerEvent) => { this.drag = { x: e.clientX, y: e.clientY, az: this.azGoal, moved: false, id: e.pointerId }; };
    const move = (e: PointerEvent) => {
      this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (!this.drag || this.drag.id !== e.pointerId) return;
      const dx = e.clientX - this.drag.x;
      if (Math.abs(dx) > 6 || Math.abs(e.clientY - this.drag.y) > 6) this.drag.moved = true;
      if (this.drag.moved && this.entered) this.azGoal = this.drag.az - dx * 0.008;
    };
    const up = (e: PointerEvent) => {
      const d = this.drag; this.drag = null;
      if (!d || d.moved || !this.entered) return;
      this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      const hit = this.pick();
      if (hit) { this.ev.onSfx("click"); hit.onClick?.(); return; }
      // marken
      this.ray.setFromCamera(this.ndc, this.camera);
      const p = new THREE.Vector3();
      if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return;
      if (!this.island.walkable(p.x, p.z)) { const l = Math.hypot(p.x, p.z); const R = this.cfg.world!.radius - 0.4; if (l > R && l < R + 6) p.multiplyScalar(R / l); else return; }
      this.target = p.setY(0); this.goal = null; this.waypoints = []; this.running = false; this.panelOpen = false;
      this.showMarker(p);
    };
    const wheel = (e: WheelEvent) => { if (this.entered) this.zoom = THREE.MathUtils.clamp(this.zoom * (1 + Math.sign(e.deltaY) * 0.08), 0.55, 1.6); };
    const resize = () => {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight); this.post.resize(innerWidth, innerHeight);
    };
    const mm = this.overlay.minimap;
    const mmClick = (e: MouseEvent) => {
      const r = mm.getBoundingClientRect(), R = this.cfg.world!.radius * 1.25;
      const u = ((e.clientX - r.left) / r.width) * 2 - 1, v = ((e.clientY - r.top) / r.height) * 2 - 1;
      // minikartan är roterad med kameran: upp = kamerans framåt
      const ca = Math.cos(this.az), sa = Math.sin(this.az);
      const wx = (u * ca + v * sa) * R, wz = (-u * sa + v * ca) * R;
      let best: Place | null = null, bd = 1.6;
      for (const pl of this.places) { const d = Math.hypot(pl.spot.x - wx, pl.spot.z - wz); if (d < bd) { bd = d; best = pl; } }
      if (best) this.walkTo(best);
      else if (this.island.walkable(wx, wz)) { this.target = new THREE.Vector3(wx, 0, wz); this.goal = null; this.running = false; }
    };
    addEventListener("keydown", kd); addEventListener("keyup", ku); addEventListener("blur", blur);
    dom.addEventListener("pointerdown", down); addEventListener("pointermove", move); addEventListener("pointerup", up);
    dom.addEventListener("wheel", wheel, { passive: true }); addEventListener("resize", resize); mm.addEventListener("click", mmClick);
    this.disposers.push(() => {
      removeEventListener("keydown", kd); removeEventListener("keyup", ku); removeEventListener("blur", blur);
      dom.removeEventListener("pointerdown", down); removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      dom.removeEventListener("wheel", wheel); removeEventListener("resize", resize); mm.removeEventListener("click", mmClick);
    });
  }

  private showMarker(p: THREE.Vector3) {
    const m = this.overlay.marker; m.classList.remove("on"); void m.offsetWidth; m.classList.add("on");
    this.markerAt = p.clone();
  }
  private markerAt: THREE.Vector3 | null = null;

  private pick(): Interactive | null {
    this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObjects(this.interactives.map((i) => i.hit ?? i.obj), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) { const f = this.interactives.find((i) => (i.hit ?? i.obj) === o); if (f) return f; o = o.parent; }
    }
    return null;
  }

  private setHighlight(hs: Interactive | null) {
    for (const [m, v] of this.highlight) { const sm = m as THREE.MeshStandardMaterial; sm.emissive.copy(v.e); sm.emissiveIntensity = v.i; }
    this.highlight.clear();
    if (!hs || hs.id === "character") return;
    const accent = new THREE.Color(this.cfg.palette.accent);
    hs.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || !m.isMeshStandardMaterial || this.highlight.has(m)) return;
      this.highlight.set(m, { e: m.emissive.clone(), i: m.emissiveIntensity }); m.emissive.copy(accent); m.emissiveIntensity = 0.22;
    });
  }

  /** Försök flytta; glid längs hinder och ökanten. */
  /** Fotsteg: ljud när en fot sätts i marken. Riggad gång → fötternas höjd (lokalt minimum med hysteres),
   *  annars följer det den procedurella studsen. Underlaget (gräs/stig/sand/brygga) läses från ön. */
  private steps(t: number, dt: number) {
    if (!this.feet) {
      this.feet = [];
      for (const n of ["LeftToeBase", "RightToeBase"]) {
        const b = this.char.root.getObjectByName(n) ?? this.char.root.getObjectByName(n.replace("ToeBase", "Foot"));
        if (b) this.feet.push({ b, lo: 0, hi: 0, up: true, n: 0 });
      }
    }
    if (!this.walking || !this.entered) { for (const f of this.feet) { f.n = 0; f.up = true; } this.stepPhase = 0; return; }
    const pos = this.char.root.position, surf = this.island.surface(pos.x, pos.z);
    if (this.feet.length === 2 && this.char.rigged && this.moveClip) {
      this.feet.forEach((f, i) => {
        const y = f.b.getWorldPosition(this.tmpV).y - pos.y;
        if (f.n++ === 0) { f.lo = f.hi = y; return; }
        const r0 = f.hi - f.lo;
        f.lo = Math.min(y, f.lo + r0 * dt * 0.4); f.hi = Math.max(y, f.hi - r0 * dt * 0.4);
        const r = f.hi - f.lo; if (r < this.charH * 0.015 || f.n < 6) return;
        if (f.up && y < f.lo + r * 0.22) { f.up = false; footstep(surf, this.running, i ? 1 : -1); }
        else if (!f.up && y > f.lo + r * 0.6) f.up = true;
      });
    } else {
      const ph = Math.floor((t * 11) / Math.PI);
      if (this.stepPhase && ph !== this.stepPhase) footstep(surf, this.running, ph % 2 ? 1 : -1);
      this.stepPhase = ph;
    }
  }

  private tryMove(p: THREE.Vector3, dx: number, dz: number) {
    const ok = (x: number, z: number) => {
      if (!this.island.walkable(x, z)) return false;
      for (const c of this.colliders) if (Math.hypot(x - c.x, z - c.z) < c.r + this.charR) return false;
      return true;
    };
    if (ok(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return true; }
    // glid: försök vinklar ±30/60° runt rörelseriktningen
    const len = Math.hypot(dx, dz), a0 = Math.atan2(dx, dz);
    for (const da of [0.5, -0.5, 1.0, -1.0, 1.4, -1.4]) {
      const a = a0 + da, nx = Math.sin(a) * len * 0.8, nz = Math.cos(a) * len * 0.8;
      if (ok(p.x + nx, p.z + nz)) { p.x += nx; p.z += nz; return true; }
    }
    return false;
  }

  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, vis: p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2 };
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    const W = this.cfg.world!;
    this.tweens.update();
    for (const u of this.updaters) u(t, dt);
    if (!this.char) return;
    const root = this.char.root, pos = root.position;

    // ---------- rörelse ----------
    let mx = 0, mz = 0;
    if (this.entered && !this.panelOpen) {
      const k = this.keys;
      const f = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0);
      const s = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
      if (f || s) {
        // framåt = bort från kameran
        const fx = -Math.sin(this.az), fz = -Math.cos(this.az), rx = Math.cos(this.az), rz = -Math.sin(this.az);
        mx = fx * f + rx * s; mz = fz * f + rz * s; this.running = k.has("shift");
      } else if (this.target) {
        const dx = this.target.x - pos.x, dz = this.target.z - pos.z, d = Math.hypot(dx, dz);
        if (d < 0.12) {
          if (this.waypoints.length) this.target = this.waypoints.shift()!;
          else { const g = this.goal; this.target = null; this.goal = null; if (g) this.arrive(g); }
        }
        else { mx = dx / d; mz = dz / d; }
      }
    }
    const moving = Math.hypot(mx, mz) > 0.01;
    if (moving) {
      const l = Math.hypot(mx, mz); mx /= l; mz /= l;
      const speed = (W.speed ?? 1.3) * this.charH * (this.running ? 1.9 : 1);
      const step = Math.min(speed * dt, this.target ? Math.hypot(this.target.x - pos.x, this.target.z - pos.z) : 99);
      const before = pos.clone();
      if (!this.tryMove(pos, mx * step, mz * step)) this.stuck += dt; else this.stuck = pos.distanceTo(before) < step * 0.2 ? this.stuck + dt : 0;
      if (this.stuck > 0.8) { this.stuck = 0; const g = this.goal; this.target = null; this.goal = null; if (g && pos.distanceTo(g.spot) < 2.2) this.arrive(g); }
      this.char.st.yaw = lerpAngle(this.char.st.yaw, Math.atan2(mx, mz), Math.min(1, dt * 12));
      this.idleFor = 0;
    } else {
      this.idleFor += dt; this.faceLock -= dt;
      // står man still en stund vänder sig karaktären mot kameran (ansiktet ska synas)
      if (this.idleFor > (this.panelOpen ? 0.3 : 2.2) && this.faceLock <= 0) this.char.st.yaw = lerpAngle(this.char.st.yaw, this.az, Math.min(1, dt * 2.5));
    }
    // gång eller spring (klippet "run" om det finns, annars snabbare gång)
    const wc = W.walkClip && this.char.actions.has(W.walkClip) ? W.walkClip : undefined;
    const rc = this.running && this.char.actions.has("run") ? "run" : wc;
    const clip = moving ? rc : undefined;
    if (moving !== this.walking || clip !== this.moveClip) { this.walking = moving; this.moveClip = clip; this.char.loop(clip); }
    if (this.walking && wc) { const a = this.char.actions.get(wc); if (a) a.timeScale = this.running && rc === wc ? 1.7 : 1.05; }
    // procedurell studs om det inte finns gångklipp
    if (this.walking && !(W.walkClip && this.char.actions.has(W.walkClip))) root.position.y = Math.abs(Math.sin(t * 11)) * this.charH * 0.06;
    else if (!this.walking && root.position.y > 0 && !this.char.rigged) root.position.y *= 0.8;
    this.char.pointer.set(0, 0);
    this.char.update(t, dt, this.camera);
    this.steps(t, dt);

    // ---------- nära en plats? ----------
    let near: Place | null = null;
    for (const pl of this.places) if (Math.hypot(pl.spot.x - pos.x, pl.spot.z - pos.z) < 1.25) near = pl;
    if (near !== this.near) { this.near?.pin.classList.remove("near"); near?.pin.classList.add("near"); this.near = near; }
    const nearKey = near && !this.walking && !this.panelOpen ? near.id : "";
    if (nearKey !== this.nearKey) { this.nearKey = nearKey; this.ev.onNear(nearKey && near ? { label: near.label, open: near.open } : null); }

    // ---------- kamera ----------
    this.az = lerpAngle(this.az, this.azGoal, Math.min(1, dt * 6));
    this.focus.lerp(pos, Math.min(1, dt * 4));
    const C = W.camera, mob = this.camera.aspect < 1 ? 1.35 : 1;
    const dist = C.dist * this.zoom * mob * (this.panelOpen ? 0.8 : 1), h = C.height * this.zoom * mob * (this.panelOpen ? 0.75 : 1);
    const look = this.focus.clone().add(new THREE.Vector3(0, this.charH * 0.55 + h * 0.14, 0));
    const follow = new THREE.Vector3(look.x + Math.sin(this.az) * dist, look.y + h, look.z + Math.cos(this.az) * dist);
    if (this.panelOpen && !isMobile) { // panelen till höger → skjut vyn så karaktären hamnar till vänster
      const right = new THREE.Vector3(Math.cos(this.az), 0, -Math.sin(this.az));
      look.addScaledVector(right, dist * 0.28); follow.addScaledVector(right, dist * 0.28);
    }
    // före ENTER: långsam bana runt hela ön
    const R = W.radius, oa = t * 0.08;
    const orbit = new THREE.Vector3(Math.sin(oa) * R * 2.5, R * 0.55, Math.cos(oa) * R * 2.5), orbitLook = new THREE.Vector3(0, -R * 0.3, 0);
    const k = this.enterK;
    this.camera.position.lerpVectors(orbit, follow, k);
    this.camera.lookAt(orbitLook.lerp(look, k));
    this.camera.updateMatrixWorld(); // så pins/bubbla projiceras mot DENNA frames kamera

    // ---------- hover ----------
    if (this.entered && !this.drag && !isMobile) {
      const hs = this.pick();
      if (hs !== this.hovered) { this.hovered = hs; this.setHighlight(hs); this.renderer.domElement.style.cursor = hs ? "pointer" : "grab"; if (hs) this.ev.onSfx("hover"); }
    }

    // ---------- pins, pratbubbla, markör ----------
    for (const pl of this.places) {
      const p = this.project(pl.top), d = this.camera.position.distanceTo(pl.top);
      pl.pin.style.transform = `translate(${p.x}px, ${Math.max(p.y, 64)}px) translate(-50%, -100%) scale(${THREE.MathUtils.clamp(14 / d, 0.7, 1.1)})`;
      pl.pin.style.opacity = this.entered && p.vis ? "1" : "0";
    }
    if (this.entered && !this.panelOpen && !this.walking && t > this.nextQuip && this.nextQuip > 0) this.say();
    if (t > this.bubbleUntil) this.overlay.bubble.classList.remove("show");
    const hp = this.project(this.char.headWorld());
    this.overlay.bubble.style.transform = `translate(${hp.x}px, ${hp.y}px) translate(-50%, -100%)`;
    if (this.markerAt) { const mp = this.project(this.markerAt); this.overlay.marker.style.transform = `translate(${mp.x}px, ${mp.y}px) translate(-50%, -50%)`; }

    // ---------- minikarta (10 fps) ----------
    this.mmAcc += dt; if (this.mmAcc > 0.1) { this.mmAcc = 0; this.drawMinimap(); }

    this.post.tick(t);
    this.post.composer.render(dt);
  }

  private drawMinimap() {
    const cv = this.overlay.minimap, x = cv.getContext("2d")!, S = cv.width, W = this.cfg.world!, P = this.cfg.palette;
    const R = W.radius * 1.25, sc = S / 2 / R;
    x.clearRect(0, 0, S, S);
    x.save(); x.translate(S / 2, S / 2);
    x.rotate(this.az); // kamerans framåt = upp
    const w2m = (px: number, pz: number) => [px * sc, pz * sc] as const;
    x.fillStyle = W.ground.grass; x.strokeStyle = W.kind === "sea" ? W.ground.sand : W.ground.rock2; x.lineWidth = 4;
    x.beginPath(); x.arc(0, 0, W.radius * sc, 0, 7); x.fill(); x.stroke();
    x.strokeStyle = W.ground.path; x.lineWidth = 3; x.lineCap = "round";
    for (const pl of this.places) { if (pl.id === "pier") continue; const [a, b] = w2m(pl.spot.x, pl.spot.z); x.beginPath(); x.moveTo(0, 0); x.lineTo(a, b); x.stroke(); }
    for (const pl of this.places) {
      const [a, b] = w2m(pl.face.x, pl.face.z);
      x.fillStyle = pl === this.near ? P.accent2 : P.accent; x.strokeStyle = "#000"; x.lineWidth = 2;
      x.beginPath(); x.arc(a, b, 6, 0, 7); x.fill(); x.stroke();
    }
    const p = this.char.root.position, [cx, cz] = w2m(p.x, p.z);
    x.translate(cx, cz); x.rotate(-this.char.st.yaw + Math.PI);
    x.fillStyle = "#fff"; x.strokeStyle = "#000"; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -8); x.lineTo(6, 6); x.lineTo(0, 3); x.lineTo(-6, 6); x.closePath(); x.fill(); x.stroke();
    x.restore();
  }

  dispose() {
    this.renderer.setAnimationLoop(null); this.post.dispose();
    this.disposers.forEach((d) => d());
    this.overlay.pins.innerHTML = "";
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
