import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OpenTarget, SiteConfig } from "../../types";
import { buildRoom, type Interactive } from "./room";
import { buildProps } from "../../core/props";
import { buildCharacter } from "../../core/character";
import { buildScreens } from "./screens";
import { buildAmbient, buildBurst } from "../../core/particles";
import { buildPost } from "../../core/post";
import { makeLoader, Tweens, ease, isMobile, worldBox } from "../../core/util";

export interface EngineEvents {
  onProgress: (p: number) => void;
  onOpen: (target: OpenTarget) => void;
  onSfx: (kind: "hover" | "click" | "whoosh" | "pop") => void;
}
export interface Overlay { label: HTMLElement; bubble: HTMLElement }

type Upd = (t: number, dt: number) => void;

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  private post!: ReturnType<typeof buildPost>;
  private tweens = new Tweens();
  private updaters: Upd[] = [];
  private interactives: Interactive[] = [];
  private editables: { id: string; obj: THREE.Object3D }[] = [];
  private char!: Awaited<ReturnType<typeof buildCharacter>>;
  private burst = buildBurst([]);
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2(9, 9);
  private hovered: Interactive | null = null;
  private busy = false;
  private saved = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  private lastInput = performance.now();
  private bubbleUntil = 0;
  private nextQuip = 0;
  private entered = false;
  private panelOpen = false;
  private down = { x: 0, y: 0, t: 0 };
  private highlight = new Map<THREE.Material, { e: THREE.Color; i: number }>();
  private disposers: (() => void)[] = [];
  readonly pixelRatio: number;

  constructor(private el: HTMLElement, private cfg: SiteConfig, private overlay: Overlay, private ev: EngineEvents) {
    this.pixelRatio = Math.min(devicePixelRatio, isMobile ? 1.25 : 1.75);
    this.renderer = new THREE.WebGLRenderer({ antialias: !cfg.post.pixelate, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);

    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    const C = cfg.room!.camera;
    this.camera = new THREE.PerspectiveCamera(isMobile ? C.fov + 10 : C.fov, innerWidth / innerHeight, 0.1, 200);
    // före ENTER: långt ut och högt upp — introt flyger in
    const start = new THREE.Vector3(...C.pos).sub(new THREE.Vector3(...C.target)).multiplyScalar(2.4).add(new THREE.Vector3(...C.target)).add(new THREE.Vector3(0, 3, 0));
    this.camera.position.copy(start);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...C.target);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false; this.controls.enabled = false;
    this.controls.rotateSpeed = 0.55; this.controls.zoomSpeed = 0.7;
    this.camera.lookAt(this.controls.target);

    this.post = buildPost(this.renderer, this.scene, this.camera, cfg.post, this.pixelRatio);
    this.bindInput();
  }

  async load() {
    const cfg = this.cfg;
    const manager = new THREE.LoadingManager();
    let expected = 1 + cfg.props.length + (cfg.character.clips?.length ?? 0) + cfg.room!.decor.filter((d) => d.type === "frame").length;
    let done = 0;
    const bump = () => { done++; this.ev.onProgress(Math.min(0.98, done / Math.max(expected, 1))); };
    manager.onLoad = () => this.ev.onProgress(1);
    const loadGLB = makeLoader(manager);
    const load = async (u: string) => { const r = await loadGLB(u); bump(); return r; };
    const texLoader = new THREE.TextureLoader(manager);

    const room = buildRoom(cfg, this.scene, texLoader);
    this.updaters.push(...room.updaters);
    this.interactives.push(...room.interactives);
    this.editables.push(...room.editables);

    const [props, char] = await Promise.all([
      buildProps(cfg.props, load, this.scene, room.halo),
      buildCharacter(cfg.character, load, this.scene, new THREE.Vector3(...cfg.room!.camera.pos)),
    ]);
    this.char = char;
    this.updaters.push(...props.updaters);
    this.interactives.push(...props.interactives);
    this.editables.push(...props.editables, { id: "character", obj: char.root });

    const screens = buildScreens(cfg, this.scene, props.byId);
    this.updaters.push(...screens.updaters);
    this.interactives.push(...screens.interactives);
    this.editables.push(...screens.editables);

    // karaktären: klickbar, alltid tydligt belyst
    this.interactives.push({ obj: char.root, label: cfg.character.label, id: "character", onClick: () => this.poke() });
    // osynliga träffboxar för GLB:er (raycast mot skinnade 20k-tris-meshar varje frame är dyrt och svårträffat)
    const glbIds = new Set(["character", ...cfg.props.map((p) => p.id)]);
    for (const i of this.interactives) {
      if (!i.id || !glbIds.has(i.id)) continue;
      const b = worldBox(i.obj), sz = b.getSize(new THREE.Vector3());
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(sz.x * 1.05, sz.y * 1.02, sz.z * 1.05), new THREE.MeshBasicMaterial({ visible: false }));
      b.getCenter(proxy.position); this.scene.add(proxy); i.hit = proxy;
    }
    if (cfg.character.spotlight) {
      const sp = new THREE.SpotLight(cfg.character.spotlight, 2.4, 9, 0.42, 0.85, 1.4);
      const cb = worldBox(char.root); const c = cb.getCenter(new THREE.Vector3());
      sp.position.set(c.x + 0.8, cb.max.y + 3.2, c.z + 2.2); sp.target.position.copy(c);
      this.scene.add(sp, sp.target);
    }

    if (cfg.room!.particles) {
      const p = cfg.room!.particles;
      const amb = buildAmbient(p.kind, p.count, p.color, cfg.room!.width, cfg.room!.depth, cfg.room!.height);
      this.scene.add(amb.obj); this.updaters.push(amb.update);
    }
    this.burst = buildBurst([cfg.palette.accent, cfg.palette.accent2, "#ffffff"]);
    this.scene.add(this.burst.obj); this.updaters.push(this.burst.update);

    // kompilera shaders innan ENTER så introt inte hackar
    this.renderer.compile(this.scene, this.camera);
    this.ev.onProgress(1);
    this.renderer.setAnimationLoop(() => this.frame());
    if (import.meta.env.DEV || location.search.includes("edit")) (window as unknown as { memeroom: Engine }).memeroom = this;
    if (location.search.includes("edit")) import("./edit").then((m) => m.startEdit(this, this.editables));
  }

  /** Startvyn, backad på smala/porträttskärmar så hela rummet får plats i bredd. */
  private homePos() {
    const C = this.cfg.room!.camera, tgt = new THREE.Vector3(...C.target);
    const off = new THREE.Vector3(...C.pos).sub(tgt);
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    const ref = Math.tan(THREE.MathUtils.degToRad(C.fov / 2)) * 1.6;
    const fit = THREE.MathUtils.clamp(ref / tanH, 1, 2.1);
    return tgt.add(off.multiplyScalar(fit));
  }

  /** ENTER: flyg in till startvyn. */
  enter() {
    if (this.entered) return; this.entered = true;
    const from = this.camera.position.clone();
    const to = this.homePos();
    this.busy = true;
    this.tweens.add(2600, (k) => { this.camera.position.lerpVectors(from, to, k); this.camera.lookAt(this.controls.target); }, () => {
      this.busy = false; this.controls.enabled = true; this.applyLimits();
      this.nextQuip = this.clock.elapsedTime + 1.2;
    });
  }

  private applyLimits() {
    const C = this.cfg.room!.camera, o = C.orbit;
    const off = this.homePos().sub(new THREE.Vector3(...C.target));
    const az = Math.atan2(off.x, off.z), dist = off.length();
    this.controls.minAzimuthAngle = az - o.azimuth; this.controls.maxAzimuthAngle = az + o.azimuth;
    this.controls.minPolarAngle = o.polarMin; this.controls.maxPolarAngle = o.polarMax;
    this.controls.minDistance = dist * o.zoomIn; this.controls.maxDistance = dist * o.zoomOut;
  }

  /** Flyg till hotspot som öppnar target (om den finns i rummet), öppna sedan panelen. */
  open(target: OpenTarget) {
    if (target.startsWith("link:")) { this.ev.onOpen(target); return; }
    // skärmar först, sedan props, sist väggdekor
    const rank = (i: Interactive) => (i.id?.startsWith("screen:") ? 0 : i.id?.startsWith("decor:") ? 2 : 1);
    const hs = this.interactives.filter((i) => i.open === target).sort((a, b) => rank(a) - rank(b))[0];
    if (!hs || this.busy) { this.panelOpen = true; this.ev.onOpen(target); return; }
    this.flyTo(hs, () => this.ev.onOpen(target));
  }

  private flyTo(hs: Interactive, done: () => void) {
    if (!this.panelOpen) { this.saved.pos.copy(this.camera.position); this.saved.tgt.copy(this.controls.target); }
    this.panelOpen = true;
    const b = worldBox(hs.obj), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const dir = hs.normal ? hs.normal.clone() : this.camera.position.clone().sub(c).setY(0).normalize();
    const size = Math.max(s.x, s.y, s.z);
    const dist = Math.max(1.6, (size * 2.3) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / Math.min(1, this.camera.aspect));
    const to = c.clone().addScaledVector(dir, dist); to.y = c.y + size * 0.12;
    // panelen ligger till höger på desktop — skjut vyn så objektet hamnar i vänstra halvan
    const tgt = c.clone();
    if (!isMobile) { const rightV = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize(); tgt.addScaledVector(rightV, -dist * 0.28); to.addScaledVector(rightV, -dist * 0.28); }
    this.tweenCam(to, tgt, 1100, done);
    this.ev.onSfx("whoosh");
  }

  closePanel() {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    this.tweenCam(this.saved.pos.clone(), this.saved.tgt.clone(), 1000, () => {});
  }

  private tweenCam(pos: THREE.Vector3, tgt: THREE.Vector3, ms: number, done: () => void) {
    this.busy = true; this.controls.enabled = false;
    const fp = this.camera.position.clone(), ft = this.controls.target.clone();
    this.tweens.add(ms, (k) => { this.camera.position.lerpVectors(fp, pos, k); this.controls.target.lerpVectors(ft, tgt, k); this.camera.lookAt(this.controls.target); }, () => {
      this.busy = false; if (!this.panelOpen) this.controls.enabled = true; done();
    }, ease.inOutCubic);
  }

  /** Klick på karaktären: reaktionsklipp + pratbubbla + burst. */
  poke() {
    this.char.react();
    this.say();
    this.burst.fire(this.char.headWorld());
    this.ev.onSfx("pop");
  }

  say(text?: string) {
    const q = this.cfg.character.quotes; if (!q.length) return;
    this.overlay.bubble.textContent = text ?? q[Math.floor(Math.random() * q.length)];
    this.overlay.bubble.classList.add("show");
    this.bubbleUntil = this.clock.elapsedTime + 3.6;
    this.nextQuip = this.clock.elapsedTime + 10 + Math.random() * 8;
  }

  private bindInput() {
    const dom = this.renderer.domElement;
    const onMove = (e: PointerEvent) => {
      this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (this.char) this.char.pointer.copy(this.ndc);
      this.lastInput = performance.now();
    };
    const onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    const onUp = (e: PointerEvent) => {
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
      if (moved > 6 || this.busy || !this.entered) return;
      this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      const hit = this.pick();
      if (!hit) return;
      this.ev.onSfx("click");
      if (hit.onClick) hit.onClick();
      else if (hit.open) this.open(hit.open);
    };
    const onResize = () => {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight); this.post.resize(innerWidth, innerHeight);
      if (this.entered && !this.panelOpen && !this.busy) this.applyLimits();
    };
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    addEventListener("resize", onResize);
    this.disposers.push(() => { dom.removeEventListener("pointermove", onMove); dom.removeEventListener("pointerdown", onDown); dom.removeEventListener("pointerup", onUp); removeEventListener("resize", onResize); });
  }

  private pick(): Interactive | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const objs = this.interactives.map((i) => i.hit ?? i.obj);
    const hits = this.raycaster.intersectObjects(objs, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) { const hit = this.interactives.find((i) => (i.hit ?? i.obj) === o); if (hit) return hit; o = o.parent; }
    }
    return null;
  }

  private setHighlight(hs: Interactive | null) {
    for (const [m, v] of this.highlight) { const sm = m as THREE.MeshStandardMaterial; sm.emissive.copy(v.e); sm.emissiveIntensity = v.i; }
    this.highlight.clear();
    if (!hs) return;
    const accent = new THREE.Color(this.cfg.palette.accent);
    hs.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m || !m.isMeshStandardMaterial || this.highlight.has(m)) return;
      this.highlight.set(m, { e: m.emissive.clone(), i: m.emissiveIntensity });
      m.emissive.copy(accent); m.emissiveIntensity = 0.28;
    });
  }

  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, visible: p.z < 1 };
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    this.tweens.update();
    for (const u of this.updaters) u(t, dt);
    this.char?.update(t, dt, this.camera);

    // hover (inte under flygningar/drag)
    if (this.entered && !this.busy && !this.panelOpen) {
      const hs = this.pick();
      if (hs !== this.hovered) {
        this.hovered = hs; this.setHighlight(hs);
        this.renderer.domElement.style.cursor = hs ? "pointer" : "grab";
        if (hs?.label) { this.overlay.label.textContent = hs.label; this.overlay.label.classList.add("show"); this.ev.onSfx("hover"); }
        else this.overlay.label.classList.remove("show");
      }
      if (hs?.label) {
        const b = worldBox(hs.obj); const p = this.project(new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.12, (b.min.z + b.max.z) / 2));
        this.overlay.label.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      }
    } else if (this.hovered) { this.hovered = null; this.setHighlight(null); this.overlay.label.classList.remove("show"); }

    // pratbubbla ovanför huvudet
    if (this.char) {
      if (this.entered && !this.panelOpen && t > this.nextQuip && this.nextQuip > 0) this.say();
      if (t > this.bubbleUntil) this.overlay.bubble.classList.remove("show");
      const p = this.project(this.char.headWorld());
      this.overlay.bubble.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }

    // lätt tomgångssvaj när ingen rört något på en stund
    if (this.entered && !this.busy && !this.panelOpen && performance.now() - this.lastInput > 7000) {
      this.controls.autoRotate = true;
      const az = this.controls.getAzimuthalAngle();
      if (az >= this.controls.maxAzimuthAngle - 0.02) this.controls.autoRotateSpeed = -0.35;
      else if (az <= this.controls.minAzimuthAngle + 0.02) this.controls.autoRotateSpeed = 0.35;
      else if (this.controls.autoRotateSpeed === 2) this.controls.autoRotateSpeed = 0.35;
    } else this.controls.autoRotate = false;

    if (!this.busy && this.controls.enabled) this.controls.update(dt);
    if (!this.entered) { const r = this.camera.position.clone().sub(this.controls.target); r.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.06 * dt); this.camera.position.copy(this.controls.target).add(r); this.camera.lookAt(this.controls.target); }
    this.post.tick(t);
    this.post.composer.render(dt);
  }

  get layout() { return this.editables; }

  dispose() {
    this.renderer.setAnimationLoop(null); this.post.dispose();
    this.disposers.forEach((d) => d());
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
