import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { FilmBeat, FilmCam, SiteConfig } from "../../types";
import { buildCharacter } from "../../core/character";
import { makeLoader, worldBox, isMobile } from "../../core/util";

/**
 * Scroll-filmen: EN fast canvas bakom hela sidan. Scrollen översätts till en "beat-position" (0 = hero … N-1 = sista beat);
 * kameran, karaktärens klipp, sida, bakgrundsfärg och set pieces (dash, regn, bubbla, anatomipilar) drivs av den.
 * Allt tweenas med tid (inte bara scroll) så det känns mjukt även med mushjul.
 */

const D2R = Math.PI / 180;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

type Cam = Required<FilmCam>;
const full = (c: FilmCam): Cam => ({ pitch: 6, fov: 30, ...c });
function mixCam(a: Cam, b: Cam, k: number): Cam {
  return { yaw: lerp(a.yaw, b.yaw, k), pitch: lerp(a.pitch, b.pitch, k), dist: lerp(a.dist, b.dist, k), lookY: lerp(a.lookY, b.lookY, k), side: lerp(a.side, b.side, k) as -1, fov: lerp(a.fov, b.fov, k) };
}

export interface FilmHooks {
  onProgress: (p: number) => void;
  /** Aktiv beat bytts (för kapitelmeny + ljud). */
  onBeat: (i: number) => void;
  /** Bubblan sprack (ljud). */
  onPop: () => void;
  /** Klick på karaktären. */
  onPoke: () => void;
}

export class Film {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
  char!: Awaited<ReturnType<typeof buildCharacter>>;
  private beats: FilmBeat[];
  private cams: Cam[];
  private bgs: THREE.Color[];
  private secs: HTMLElement[] = [];
  private clock = new THREE.Clock();
  private H: number;
  private cam!: Cam;
  private bPos = 0;
  private active = -1;
  private spin = 0; private spinV = 0; private dragging = false; private dragX = 0; private dragMoved = 0;
  private charX = 0; private yaw = 0;
  private rain: { mesh: THREE.InstancedMesh; p: { x: number; y: number; z: number; v: number; s: number; rx: number; ry: number }[] } | null = null;
  private bubble: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; bone: THREE.Object3D | null; t: number; popT: number } | null = null;
  private drops: { mesh: THREE.InstancedMesh; v: THREE.Vector3[]; p: THREE.Vector3[]; life: number[] } | null = null;
  private anatomy: { bone: THREE.Object3D | null; off: THREE.Vector3; rest: THREE.Vector3 }[] = [];
  private bubbleRest = new THREE.Vector3();
  private center = new THREE.Vector3();
  private baseX = 0;
  private qInv = new THREE.Quaternion();
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3(); private tmp3 = new THREE.Vector3(); private tmp4 = new THREE.Vector3(); private dummy = new THREE.Object3D();
  private halfW = 2;
  /** Skärmpunkter för anatomipilarna (px), läses av vyn. */
  points: { x: number; y: number; vis: boolean }[] = [];
  private root: HTMLElement;

  constructor(private host: HTMLElement, private site: SiteConfig, private hooks: FilmHooks, root: HTMLElement) {
    this.root = root;
    const L = site.landing!;
    this.beats = L.beats;
    this.cams = L.beats.map((b) => full(b.cam));
    this.bgs = L.beats.map((b) => new THREE.Color(b.bg ?? site.palette.bg));
    this.cam = { ...this.cams[0] };
    this.H = site.character.height;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 1.75));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a70, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(3, 6, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(site.palette.accent2), 1.6); rim.position.set(-4, 3, -4); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-4, 1, 3); this.scene.add(fill);
    addEventListener("resize", this.resize);
    this.resize();
    this.bindPointer();
  }

  async load() {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_u, a, b) => this.hooks.onProgress(Math.min(0.95, a / Math.max(1, b)));
    const load = makeLoader(manager);
    const c = this.site.character;
    this.char = await buildCharacter({ ...c, pos: [0, 0, 0], rotY: 0 }, load, this.scene, new THREE.Vector3(0, 1, 5));
    // alla klipp i huvud-GLB:n ska stå på stället (dash-förflyttningen styr vi själva)
    this.char.actions.forEach((a) => {
      for (const tr of a.getClip().tracks) {
        if (!tr.name.endsWith(".position") || !/hips|root|pelvis/i.test(tr.name)) continue;
        const v = tr.values; const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      }
    });
    this.calmIdle(0.35);
    this.faceForward();
    // Meshy lägger basfärgen som emissive-karta → urblekt/självlysande; dra ned den
    this.char.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.emissiveMap && (!m.map || m.emissiveMap.source === m.map.source)) m.emissiveIntensity = 0.18;
    });
    this.char.root.updateMatrixWorld(true);
    const box = worldBox(this.char.root);
    this.H = box.getSize(this.tmp).y || this.H;
    // normalize() flyttar roten så att modellens mitt hamnar i origo; kom ihåg förskjutningen (roten ≠ modellens mitt)
    this.baseX = this.char.root.position.x;
    box.getCenter(this.center).sub(this.char.root.position).setY(0);
    const L = this.site.landing!;
    const bone = (n: string) => this.char.root.getObjectByName(n) ?? null;
    this.anatomy = (L.anatomy ?? []).map((a) => { const b = bone(a.bone); return { bone: b, off: new THREE.Vector3(...(a.off ?? [0, 0.5, 0])), rest: this.localOf(b) }; });
    this.points = this.anatomy.map(() => ({ x: 0, y: 0, vis: false }));
    if (L.bubble) { this.makeBubble(L.bubble.color, bone(L.bubble.bone)); this.bubbleRest.copy(this.localOf(bone(L.bubble.bone))); }
    if (L.rain) this.makeRain(L.rain.colors, L.rain.count);
    this.hooks.onProgress(1);
    this.clock.start();
    this.renderer.setAnimationLoop(this.frame);
  }

  setSections(els: HTMLElement[]) { this.secs = els; }

  /** Meshys Idle vrider huvud/höft kraftigt; dämpa alla rotationer i idle-klippet mot vilopositionen (k = hur mycket rörelse som blir kvar). */
  private calmIdle(k: number) {
    const idle = [...this.char.actions.values()][0]; if (!idle) return;
    const model = this.char.mixer.getRoot() as THREE.Object3D;
    const rest = new THREE.Quaternion(), q = new THREE.Quaternion();
    for (const tr of idle.getClip().tracks) {
      if (!tr.name.endsWith(".quaternion")) continue;
      const node = model.getObjectByName(tr.name.split(".")[0]); if (!node) continue;
      rest.copy(node.quaternion);
      for (let i = 0; i < tr.values.length; i += 4) { q.fromArray(tr.values, i); rest.clone().slerp(q, k).toArray(tr.values, i); }
    }
  }

  /**
   * Vissa Meshy-klipp (t.ex. Idle) står snett (~40°). En landningssida vill ha karaktären mot kameran, så vi mäter
   * klippets snittriktning (höft- + axellinjen) och vrider höftens nycklar tillbaka runt uppåtaxeln.
   */
  private faceForward() {
    const model = this.char.mixer.getRoot() as THREE.Object3D;
    const hips = model.getObjectByName("Hips"), L1 = model.getObjectByName("LeftUpLeg"), R1 = model.getObjectByName("RightUpLeg");
    const L2 = model.getObjectByName("LeftShoulder") ?? model.getObjectByName("LeftArm"), R2 = model.getObjectByName("RightShoulder") ?? model.getObjectByName("RightArm");
    if (!hips || !L1 || !R1 || !L2 || !R2 || !hips.parent) return;
    const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const yawNow = () => {
      model.updateMatrixWorld(true);
      const f = (a: THREE.Object3D, b: THREE.Object3D) => new THREE.Vector3(0, 1, 0).cross(pos(b).sub(pos(a)));
      const v = f(L1, R1).add(f(L2, R2)); return Math.atan2(v.x, v.z);
    };
    const rest = yawNow();
    const tmpMixer = new THREE.AnimationMixer(model);
    this.char.actions.forEach((action) => {
      const clip = action.getClip();
      const qt = clip.tracks.find((t) => t.name === "Hips.quaternion"); if (!qt) return;
      const a = tmpMixer.clipAction(clip); a.play();
      let sx = 0, sz = 0;
      for (let k = 0; k < 12; k++) { tmpMixer.setTime((clip.duration * k) / 12); const y = yawNow() - rest; sx += Math.sin(y); sz += Math.cos(y); }
      a.stop(); tmpMixer.uncacheAction(clip);
      const avg = Math.atan2(sx, sz);
      if (Math.abs(avg) < 12 * D2R) return;
      // uppåtaxeln i höftens föräldrarum
      const pq = hips.parent!.getWorldQuaternion(new THREE.Quaternion()).premultiply(model.getWorldQuaternion(new THREE.Quaternion()).invert());
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pq.invert());
      const fix = new THREE.Quaternion().setFromAxisAngle(up, -avg), q = new THREE.Quaternion();
      const v = qt.values;
      for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i).premultiply(fix).toArray(v, i); }
      const pt = clip.tracks.find((t) => t.name === "Hips.position");
      if (pt) { const p = new THREE.Vector3(); for (let i = 0; i < pt.values.length; i += 3) { p.fromArray(pt.values, i).applyQuaternion(fix).toArray(pt.values, i); } }
    });
  }

  /** Benets position i karaktärens eget rum (utan skala): fötter i origo, +Z = framåt. */
  private localOf(b: THREE.Object3D | null, out = new THREE.Vector3()) {
    if (!b) return out.set(0, 0, 0);
    b.getWorldPosition(out).sub(this.char.root.position);
    return out.applyQuaternion(this.qInv.copy(this.char.root.quaternion).invert());
  }
  /**
   * Punkt på karaktären: `off` = läget i vila (karaktärshöjder, fötter = 0, +Z framåt) som sedan följer benets rörelse.
   * Oberoende av var riggen råkar ha sina leder.
   */
  private anchor(off: THREE.Vector3, bone: THREE.Object3D | null, rest: THREE.Vector3, out: THREE.Vector3) {
    const now = this.localOf(bone, this.tmp2);
    out.copy(off).multiplyScalar(this.H).add(now.sub(rest));
    const r = this.char.root.position;
    return out.add(this.center).applyQuaternion(this.char.root.quaternion).add(this.tmp3.set(r.x, 0, r.z));
  }

  // ---------------------------------------------------------------- set pieces
  private makeBubble(color: string, bone: THREE.Object3D | null) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.88, emissive: new THREE.Color(color), emissiveIntensity: 0.12 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), mat);
    mesh.visible = false; this.scene.add(mesh);
    this.bubble = { mesh, mat, bone, t: 1.5, popT: -1 };
    // stänk när den spricker
    const N = 40;
    const dm = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color, roughness: 0.3 }), N);
    dm.frustumCulled = false; this.scene.add(dm);
    this.drops = { mesh: dm, v: Array.from({ length: N }, () => new THREE.Vector3()), p: Array.from({ length: N }, () => new THREE.Vector3()), life: new Array(N).fill(0) };
  }

  /** Spräck bubblan nu (klick) eller låt den växa klart. */
  pop() { if (this.bubble && this.bubble.popT < 0 && this.bubble.t > 0.35) this.bubble.popT = 0; }

  private bubbleAnchor(out: THREE.Vector3) {
    const L = this.site.landing!.bubble!, b = this.bubble!;
    return this.anchor(this.tmp3.set(L.off[0], L.off[1], L.off[2]), b.bone, this.bubbleRest, out);
  }

  private updateBubble(dt: number, show: number) {
    const b = this.bubble; if (!b) return;
    const L = this.site.landing!.bubble!;
    const r = L.size * this.H;
    this.bubbleAnchor(this.tmp);
    const fwd = this.tmp2.set(0, 0, 1).applyQuaternion(this.char.root.quaternion);
    if (b.popT >= 0) {
      b.popT += dt;
      const k = b.popT / 0.12;
      b.mesh.scale.setScalar(r * (1 + k * 0.35)); b.mat.opacity = 0.88 * (1 - k);
      if (b.popT - dt <= 0) { this.splash(this.tmp.clone().addScaledVector(fwd, r), r); if (show > 0.3) this.hooks.onPop(); }
      if (k >= 1) { b.popT = -1; b.t = 0; b.mesh.visible = false; }
    } else {
      b.t += dt;
      const g = sstep(0.4, L.every * 0.85, b.t);
      const wob = 1 + Math.sin(b.t * 9) * 0.03 * g;
      const s = Math.max(0.0001, r * g) * show;
      b.mesh.visible = s > r * 0.03;
      b.mesh.scale.set(s * wob, s / wob, s * wob);
      b.mat.opacity = 0.88;
      if (b.t > L.every) b.popT = 0;
    }
    // bubblan sitter framför munnen och växer utåt
    const cur = b.mesh.scale.x;
    b.mesh.position.copy(this.tmp).addScaledVector(fwd, cur * 0.92);
  }

  private splash(at: THREE.Vector3, r: number) {
    const d = this.drops; if (!d) return;
    for (let i = 0; i < d.v.length; i++) {
      d.p[i].copy(at).add(this.tmp2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(r));
      d.v[i].set(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.2).normalize().multiplyScalar(this.H * (0.5 + Math.random() * 0.9));
      d.life[i] = 0.5 + Math.random() * 0.4;
    }
  }

  private updateDrops(dt: number) {
    const d = this.drops; if (!d) return;
    for (let i = 0; i < d.v.length; i++) {
      if (d.life[i] <= 0) { this.dummy.scale.setScalar(0); }
      else {
        d.life[i] -= dt; d.v[i].y -= this.H * 3.2 * dt; d.p[i].addScaledVector(d.v[i], dt);
        this.dummy.position.copy(d.p[i]); this.dummy.scale.setScalar(this.H * 0.012 * clamp01(d.life[i] * 3));
      }
      this.dummy.updateMatrix(); d.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    d.mesh.instanceMatrix.needsUpdate = true;
  }

  private makeRain(colors: string[], count: number) {
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0 }), count);
    mesh.frustumCulled = false;
    const p = Array.from({ length: count }, (_, i) => {
      mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      return { x: (Math.random() - 0.5) * 5, y: Math.random() * 4, z: -Math.random() * 2.5 - 0.3, v: 0.25 + Math.random() * 0.35, s: 0.03 + Math.random() * 0.05, rx: Math.random() * 6, ry: Math.random() * 6 };
    });
    this.scene.add(mesh);
    this.rain = { mesh, p };
  }

  private updateRain(dt: number, show: number) {
    const R = this.rain; if (!R) return;
    R.mesh.visible = show > 0.01;
    if (!R.mesh.visible) return;
    const H = this.H;
    R.p.forEach((q, i) => {
      q.y -= q.v * dt; q.rx += dt; if (q.y < -0.4) { q.y = 3.4; q.x = (Math.random() - 0.5) * 5; }
      this.dummy.position.set(q.x * H, q.y * H, q.z * H);
      this.dummy.scale.setScalar(q.s * H * show);
      this.dummy.rotation.set(q.rx, q.ry, 0);
      this.dummy.updateMatrix(); R.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    R.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- input
  private isUI(t: EventTarget | null) { return !!(t as HTMLElement | null)?.closest?.("a,button,input,iframe,.lf-card,.lf-nav,.lf-memes-stack img,.lf-lightbox"); }
  private bindPointer() {
    const down = (e: PointerEvent) => { if (this.isUI(e.target) || !this.char) return; this.dragging = true; this.dragX = e.clientX; this.dragMoved = 0; };
    const move = (e: PointerEvent) => {
      if (this.char) this.char.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (!this.dragging) return;
      const dx = e.clientX - this.dragX; this.dragX = e.clientX; this.dragMoved += Math.abs(dx);
      this.spinV = (dx / innerWidth) * 9; this.spin += this.spinV;
    };
    const up = (e: PointerEvent) => {
      if (!this.dragging) return; this.dragging = false;
      if (this.dragMoved < 6 && this.hitChar(e.clientX, e.clientY)) { this.pop(); this.char.react(); this.hooks.onPoke(); }
    };
    addEventListener("pointerdown", down); addEventListener("pointermove", move); addEventListener("pointerup", up);
    this.unbind = () => { removeEventListener("pointerdown", down); removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
  }
  private unbind = () => {};
  private hitChar(x: number, y: number) {
    const b = worldBox(this.char.root); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) {
      this.tmp.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camera);
      const sx = (this.tmp.x * 0.5 + 0.5) * innerWidth, sy = (-this.tmp.y * 0.5 + 0.5) * innerHeight;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return x > x0 && x < x1 && y > y0 && y < y1;
  }

  // ---------------------------------------------------------------- loop
  private resize = () => {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  };

  /** Beat-position ur scrollen: i + lokal progress (0 när sektionens topp når skärmens topp, 1 när den börjar lämna). */
  private scrollBeat() {
    const y = scrollY, vh = innerHeight; let bt = 0;
    this.secs.forEach((el, i) => {
      const top = el.offsetTop, span = Math.max(1, el.offsetHeight - vh);
      const l = clamp01((y - top) / span);
      el.style.setProperty("--p", l.toFixed(4));
      const on = y + vh > top && y < top + el.offsetHeight;
      el.classList.toggle("on", on);
      if (y >= top - 1) bt = i + l;
    });
    return bt;
  }

  private frame = () => {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    const n = this.beats.length;
    const bt = this.scrollBeat();
    this.bPos = damp(this.bPos, bt, 7, dt);
    const i = Math.min(n - 1, Math.floor(this.bPos)), l = this.bPos - i;
    const k = i < n - 1 ? sstep(0.72, 1, l) : 0;
    const act = k > 0.5 ? Math.min(n - 1, i + 1) : i;
    const beat = this.beats[act];

    // kamera
    const target = mixCam(this.cams[i], this.cams[Math.min(n - 1, i + 1)], k);
    const mobile = innerWidth < 760;
    if (mobile) target.side = 0 as 0;
    this.cam = mixCam(this.cam, target, 1 - Math.exp(-6 * dt));
    const c = this.cam, H = this.H;
    // stående skärm: backa kameran så karaktären inte fyller hela bredden
    const asp = innerWidth / innerHeight, distK = asp < 1 ? Math.min(2, Math.pow(1 / asp, 0.7)) : 1;
    const look = this.tmp.set(0, c.lookY * H, 0);
    const cp = Math.cos(c.pitch * D2R);
    this.camera.position.set(Math.sin(c.yaw * D2R) * cp, Math.sin(c.pitch * D2R), Math.cos(c.yaw * D2R) * cp).multiplyScalar(c.dist * distK * H).add(look);
    this.camera.lookAt(look);
    this.camera.fov = c.fov;
    const w = innerWidth, h = innerHeight;
    this.camera.setViewOffset(w, h, -c.side * w * 0.2, mobile ? h * 0.2 : 0, w, h);
    this.camera.updateProjectionMatrix();
    this.halfW = Math.tan((c.fov * D2R) / 2) * this.camera.aspect * c.dist * distK * H;

    // klipp per beat
    if (act !== this.active) {
      this.active = act; this.hooks.onBeat(act);
      this.char.loop(beat.clip && this.char.actions.has(beat.clip) ? beat.clip : undefined);
    }

    // dash: springer ut till höger och kommer tillbaka från vänster
    const isDash = beat.kind === "dash";
    const dl = isDash ? (act === i ? l : 0) : 0;
    let goalX = 0, goalYaw = 0;
    if (isDash) {
      const run = sstep(0.05, 0.95, dl);
      goalX = (run < 0.5 ? lerp(0, 1.35, run / 0.5) : lerp(-1.35, 0, (run - 0.5) / 0.5)) * this.halfW;
      goalYaw = 90 * D2R * sstep(0, 0.06, dl) * (1 - sstep(0.94, 1, dl));
      if (Math.abs(goalX - this.charX) > this.halfW) this.charX = goalX; // teleport vid kanten
    }
    this.charX = damp(this.charX, goalX, 10, dt);
    this.yaw = damp(this.yaw, goalYaw, 8, dt);
    if (!this.dragging) { this.spin *= Math.exp(-dt * 1.2); }
    this.char.root.position.x = this.baseX + this.charX;
    this.char.st.yaw = this.yaw + this.spin;
    this.char.update(t, dt, this.camera);

    // set pieces
    const heroShow = 1 - sstep(0.15, 0.9, this.bPos);
    const outroShow = this.beats[n - 1].kind === "outro" ? sstep(n - 1.6, n - 1, this.bPos) : 0;
    this.updateRain(dt, Math.max(heroShow, outroShow));
    this.updateBubble(dt, isDash ? 0 : 1);
    this.updateDrops(dt);

    // bakgrundsfärg
    const bg = this.bgs[i].clone().lerp(this.bgs[Math.min(n - 1, i + 1)], k);
    this.root.style.setProperty("--bg-now", `#${bg.getHexString()}`);

    this.renderer.render(this.scene, this.camera);

    // anatomipilar → skärmpunkter
    this.anatomy.forEach((a, j) => {
      const P = this.points[j];
      this.anchor(a.off, a.bone, a.rest, this.tmp4);
      this.tmp.copy(this.tmp4).project(this.camera);
      P.x = (this.tmp.x * 0.5 + 0.5) * w; P.y = (-this.tmp.y * 0.5 + 0.5) * h; P.vis = this.tmp.z < 1;
    });
    this.onFrame?.(this.bPos);
  };
  onFrame?: (b: number) => void;

  dispose() {
    this.renderer.setAnimationLoop(null); this.unbind(); removeEventListener("resize", this.resize);
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
