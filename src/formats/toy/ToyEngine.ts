import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { OpenTarget, SiteConfig } from "../../types";
import type { Interactive } from "../../core/interactive";
import { buildProps } from "../../core/props";
import { buildCharacter } from "../../core/character";
import { buildBurst } from "../../core/particles";
import { buildPost } from "../../core/post";
import { makeLoader, Tweens, ease, isMobile, worldBox, normalize, fixMaterials } from "../../core/util";

export type Mood = { love: number; milk: number };
export type GameState = { mode: "off" | "ready" | "play" | "over"; score: number; lives: number; best: number };
export type McapState = { mcap: number | null; idx: number; label: string; next: string | null; preview: boolean };
export type ToyAction = "pet" | "feed" | "toy" | "bonk";

export interface ToyEvents {
  onProgress: (p: number) => void;
  onOpen: (t: OpenTarget) => void;
  onSfx: (k: "hover" | "click" | "whoosh" | "pop" | "copy" | "open") => void;
  onMood: (m: Mood) => void;
  onGame: (g: GameState) => void;
  onMcap: (m: McapState) => void;
}

type Upd = (t: number, dt: number) => void;
interface FX { s: THREE.Sprite; v: THREE.Vector3; life: number; max: number; spin: number; orbit?: { c: THREE.Vector3; r: number; a: number } }
interface Item { obj: THREE.Object3D; kind: "good" | "bad" | "bonus"; points: number; vy: number; spin: number; r: number }

const STAGE_R = 2.6, STAGE_H = 0.45;
const store = {
  get(k: string) { try { return localStorage.getItem("memeroom:" + k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem("memeroom:" + k, v); } catch { /* privat läge */ } },
};

function spriteTex(kind: "heart" | "star" | "drop" | "note", color: string) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d")!; x.translate(64, 64);
  x.fillStyle = color; x.strokeStyle = "#1a1a1a"; x.lineWidth = 8; x.lineJoin = "round";
  x.beginPath();
  if (kind === "heart") { x.moveTo(0, 40); x.bezierCurveTo(-70, -8, -34, -64, 0, -26); x.bezierCurveTo(34, -64, 70, -8, 0, 40); }
  else if (kind === "star") { for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 50, a = (i / 10) * Math.PI * 2 - Math.PI / 2; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); }
  else if (kind === "drop") { x.moveTo(0, -46); x.bezierCurveTo(30, -6, 34, 40, 0, 42); x.bezierCurveTo(-34, 40, -30, -6, 0, -46); }
  else { x.arc(-10, 26, 18, 0, 7); x.moveTo(6, 26); x.lineTo(6, -40); x.lineTo(40, -48); x.lineTo(40, -30); x.lineTo(6, -22); }
  x.fill(); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/**
 * Format "toy": karaktären står på en snurrande piedestal. Klappa = dra över den, klick = bonk, knappar för mat/garn.
 * Arkadläge: kameran går till en sidovy, karaktären springer i sidled och fångar det som faller.
 */
export class ToyEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private post!: ReturnType<typeof buildPost>;
  private tweens = new Tweens();
  private clock = new THREE.Clock();
  private updaters: Upd[] = [];
  private interactives: Interactive[] = [];
  private char!: Awaited<ReturnType<typeof buildCharacter>>;
  private charHit!: THREE.Mesh;
  private baseScale = new THREE.Vector3(1, 1, 1);
  private root0 = new THREE.Vector3();
  private burst = buildBurst([]);
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pedestal!: THREE.Group;
  private tex: Record<string, THREE.Texture> = {};
  private fx: FX[] = [];
  private tpl: { feed: THREE.Object3D | null; toy: THREE.Object3D | null; good: (THREE.Object3D | null)[] } = { feed: null, toy: null, good: [] };
  private entered = false;
  private panelOpen = false;
  private mood: Mood = { love: 60, milk: 60 };
  private moodAcc = 0;
  private squashT = -1;
  private petAcc = 0;
  private lastPetFx = 0;
  private nextWave = 0;
  private busy = 0; // spärr för mat/garn-animationer
  private ball: { obj: THREE.Object3D; v: THREE.Vector3; jumped: boolean } | null = null;
  private down: { x: number; y: number; onChar: boolean; moved: boolean; az: number } | null = null;
  private hovered: Interactive | null = null;
  // kamera
  private az = 0; private azGoal = 0; private zoom = 1;
  private camMode: "toy" | "arcade" = "toy";
  private camK = 0; // 0 = toy, 1 = arcade
  private camIntro = 0;
  // spel
  private game: GameState = { mode: "off", score: 0, lives: 3, best: 0 };
  private items: Item[] = [];
  private spawnAcc = 0;
  private px = 0; private goalX = 0; private keys = new Set<string>();
  private walking = false;
  // mcap
  private mcap: McapState = { mcap: null, idx: -1, label: "", next: null, preview: false };
  private mcapScale = 1;
  private bubbleUntil = 0; private nextQuip = 0;
  private disposers: (() => void)[] = [];
  readonly pixelRatio: number;

  constructor(private el: HTMLElement, private cfg: SiteConfig, private overlay: { bubble: HTMLElement }, private ev: ToyEvents) {
    this.pixelRatio = Math.min(devicePixelRatio, isMobile ? 1.25 : 1.75);
    this.renderer = new THREE.WebGLRenderer({ antialias: !cfg.post.pixelate, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(isMobile ? 46 : 35, innerWidth / innerHeight, 0.1, 200);
    this.camera.position.set(0, 3, 12);
    this.post = buildPost(this.renderer, this.scene, this.camera, cfg.post, this.pixelRatio);
    const m = store.get("mood"); if (m) try { this.mood = { ...this.mood, ...JSON.parse(m) }; } catch { /* ok */ }
    this.game.best = Number(store.get("best") ?? 0) || 0;
    this.bindInput();
  }

  async load() {
    const cfg = this.cfg, T = cfg.toy!;
    const manager = new THREE.LoadingManager();
    const expected = 3 + cfg.props.length + (cfg.character.clips?.length ?? 0) + T.game.good.length;
    let done = 0;
    const loadGLB = makeLoader(manager);
    const load = async (u: string) => { const r = await loadGLB(u); done++; this.ev.onProgress(Math.min(0.97, done / expected)); return r; };
    const P = cfg.palette;

    this.buildBackdrop();
    this.buildStage();

    // ljus: key framifrån-höger, rim i accentfärg, spot på karaktären
    this.scene.add(new THREE.HemisphereLight("#ffffff", T.bg[1], 1.15));
    const key = new THREE.DirectionalLight("#fff4e6", 2.2); key.position.set(3.5, 7, 6); key.castShadow = true;
    key.shadow.mapSize.setScalar(isMobile ? 1024 : 2048); const sc = key.shadow.camera; sc.left = sc.bottom = -7; sc.right = sc.top = 7; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(P.accent, 1.6); rim.position.set(-4, 4, -5); this.scene.add(rim);
    const sp = new THREE.SpotLight("#fff1dd", 2.2, 12, 0.4, 0.8, 1.2); sp.position.set(0.6, 6.5, 2.6); sp.target.position.set(0, 1, 0); this.scene.add(sp, sp.target);

    const tplLoad = async (file: string, h: number) => { const g = await load(file); return g ? this.template(g, h) : null; };
    const [pr, char, feed, toy, ...good] = await Promise.all([
      buildProps(cfg.props, load, this.scene, () => new THREE.Sprite()),
      buildCharacter({ ...cfg.character, pos: [0, STAGE_H, 0], rotY: 0, spotlight: undefined }, load, this.scene, new THREE.Vector3(0, 0, 10)),
      tplLoad(T.treats.feed, 0.55), tplLoad(T.treats.toy, 0.34),
      ...T.game.good.map((g) => tplLoad(g.file, g.height)),
    ]);
    this.tpl = { feed, toy, good };
    this.char = char; this.baseScale.copy(char.root.scale); this.root0.set(char.root.position.x, char.root.position.y, char.root.position.z);
    this.updaters.push(...pr.updaters);
    this.interactives.push(...pr.interactives);

    const b = worldBox(char.root), s = b.getSize(new THREE.Vector3());
    this.charHit = new THREE.Mesh(new THREE.BoxGeometry(s.x * 1.1, s.y * 1.05, Math.max(s.z, 0.5) * 1.1), new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this.charHit);

    this.tex = { heart: spriteTex("heart", "#ff5c8a"), star: spriteTex("star", "#ffd84d"), drop: spriteTex("drop", "#dff3ff"), note: spriteTex("note", P.accent) };
    this.burst = buildBurst([P.accent, P.accent2, "#ffffff"]); this.scene.add(this.burst.obj); this.updaters.push(this.burst.update);

    this.ev.onMood(this.mood);
    this.ev.onGame(this.game);
    this.initMcap();
    this.renderer.compile(this.scene, this.camera);
    this.ev.onProgress(1);
    this.renderer.setAnimationLoop(() => this.frame());
    if (import.meta.env.DEV) (window as unknown as { memeroom: ToyEngine }).memeroom = this;
  }

  /** Klona-bar mall av en GLB, normaliserad till höjd h med fötterna på y = 0. */
  private template(g: GLTF, h: number) {
    const o = g.scene; fixMaterials(o);
    const inner = new THREE.Group(); inner.add(o); inner.rotation.y = -Math.PI / 2; // Tripo-framsida +X → +Z
    const w = new THREE.Group(); w.add(inner); normalize(w, h, 0, 0, 0);
    return w;
  }

  private buildBackdrop() {
    const T = this.cfg.toy!;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { a: { value: new THREE.Color(T.bg[0]) }, b: { value: new THREE.Color(T.bg[1]) }, dot: { value: new THREE.Color(this.cfg.palette.accent2) }, uTime: { value: 0 } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: `uniform vec3 a, b, dot; uniform float uTime; varying vec3 vP;
        void main(){
          vec3 c = mix(b, a, smoothstep(-.2, .7, vP.y));
          vec2 uv = vec2(atan(vP.z, vP.x) * 3.2, vP.y * 5.) + vec2(uTime * .03, -uTime * .02);
          vec2 g = fract(uv * 2.) - .5; vec2 id = floor(uv * 2.);
          float r = .16 + .06 * sin(id.x * 3.1 + id.y * 1.7);
          float d = smoothstep(r, r - .03, length(g)) * step(0., sin(id.x * 1.3 + id.y * 2.1));
          c = mix(c, mix(c, dot, .55), d * smoothstep(-.35, .2, vP.y));
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 24), mat); this.scene.add(sky);
    this.updaters.push((t) => { mat.uniforms.uTime.value = t; });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: new THREE.Color(T.bg[1]).multiplyScalar(0.92), roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    this.scene.fog = new THREE.Fog(T.bg[1], 16, 42);
  }

  private buildStage() {
    const T = this.cfg.toy!, P = this.cfg.palette;
    const g = new THREE.Group();
    // sidan: ränder
    const sc = document.createElement("canvas"); sc.width = 512; sc.height = 64; const sx = sc.getContext("2d")!;
    for (let i = 0; i < 16; i++) { sx.fillStyle = i % 2 ? T.stage.color : T.stage.color2; sx.fillRect(i * 32, 0, 32, 64); }
    const sideTex = new THREE.CanvasTexture(sc); sideTex.colorSpace = THREE.SRGBColorSpace;
    // toppen: ringar
    const tc = document.createElement("canvas"); tc.width = tc.height = 512; const tx = tc.getContext("2d")!;
    for (let i = 8; i > 0; i--) { tx.fillStyle = i % 2 ? T.stage.color2 : T.stage.color; tx.beginPath(); tx.arc(256, 256, (i / 8) * 256, 0, 7); tx.fill(); }
    const topTex = new THREE.CanvasTexture(tc); topTex.colorSpace = THREE.SRGBColorSpace;
    const side = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.45 });
    const top = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.5 });
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(STAGE_R, STAGE_R + 0.12, STAGE_H, 48), [side, top, top]);
    cyl.position.y = STAGE_H / 2; cyl.castShadow = cyl.receiveShadow = true; g.add(cyl);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(STAGE_R, 0.07, 8, 64), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = STAGE_H; g.add(lip);
    // glödlampor runt kanten
    const bulbs: THREE.MeshStandardMaterial[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, m = new THREE.MeshStandardMaterial({ color: "#fff6d8", emissive: i % 2 ? P.accent : P.accent2, emissiveIntensity: 1.2 });
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), m); b.position.set(Math.cos(a) * (STAGE_R + 0.1), STAGE_H * 0.5, Math.sin(a) * (STAGE_R + 0.1)); g.add(b); bulbs.push(m);
    }
    this.scene.add(g); this.pedestal = g;
    this.updaters.push((t) => {
      g.rotation.y = t * 0.12;
      bulbs.forEach((m, i) => { m.emissiveIntensity = 0.6 + (Math.sin(t * 5 - i * 0.8) > 0 ? 1.1 : 0); });
    });
    // bokstavsklossar med tickern
    if (T.blocks !== false) {
      const word = this.cfg.ticker.replace(/^\$/, "").toUpperCase().slice(0, 7);
      const cols = [P.accent, P.accent2, T.stage.color, T.stage.color2];
      [...word].forEach((ch, i) => {
        const c = document.createElement("canvas"); c.width = c.height = 128; const x = c.getContext("2d")!;
        x.fillStyle = cols[i % cols.length]; x.fillRect(0, 0, 128, 128);
        x.strokeStyle = "#ffffff"; x.lineWidth = 10; x.strokeRect(8, 8, 112, 112);
        x.fillStyle = "#ffffff"; x.strokeStyle = "#1a1a1a"; x.lineWidth = 8; x.font = `900 84px "${this.cfg.fonts.display}", Impact, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
        x.strokeText(ch, 64, 70); x.fillText(ch, 64, 70);
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
        const cube = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
        const n = word.length, a = ((i - (n - 1) / 2) / Math.max(n - 1, 1)) * 1.3; // båge bakom piedestalen
        cube.position.set(Math.sin(a) * 4.3, 0.425, -Math.cos(a) * 4.3); cube.rotation.y = -a + (Math.random() - 0.5) * 0.3;
        cube.castShadow = cube.receiveShadow = true; this.scene.add(cube);
        const y0 = cube.position.y;
        this.updaters.push((t) => { cube.position.y = y0 + Math.max(0, Math.sin(t * 2.2 - i * 0.7)) * 0.12; });
      });
    }
  }

  // ---------------- API för vyn ----------------
  enter() {
    if (this.entered) return; this.entered = true;
    this.tweens.add(2200, (k) => { this.camIntro = k; }, () => { this.nextQuip = this.clock.elapsedTime + 1.2; }, ease.inOutCubic);
  }
  open(t: OpenTarget) {
    if (this.game.mode !== "off") this.exitGame();
    if (!t.startsWith("link:")) this.panelOpen = true;
    this.ev.onOpen(t);
  }
  closePanel() { this.panelOpen = false; }

  act(a: ToyAction) {
    if (!this.char || this.game.mode !== "off") return;
    if (a === "bonk") this.bonk();
    else if (a === "pet") { for (let i = 0; i < 6; i++) this.spawnFx("heart", this.char.headWorld().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.2 - Math.random() * 0.3, 0.3))); this.pet(1.2); }
    else if (a === "feed") this.feed();
    else if (a === "toy") this.throwToy();
  }

  // ---------------- interaktioner ----------------
  private bump(dl: number, dm: number) {
    this.mood.love = THREE.MathUtils.clamp(this.mood.love + dl, 0, 100);
    this.mood.milk = THREE.MathUtils.clamp(this.mood.milk + dm, 0, 100);
    this.ev.onMood({ ...this.mood }); store.set("mood", JSON.stringify(this.mood));
  }
  private line(k: keyof NonNullable<SiteConfig["toy"]>["lines"]) { const l = this.cfg.toy!.lines[k]; return l[Math.floor(Math.random() * l.length)]; }

  private bonk() {
    this.squashT = 0; this.ev.onSfx("pop");
    const h = this.char.headWorld();
    for (let i = 0; i < 5; i++) this.spawnFx("star", h, { c: h.clone().add(new THREE.Vector3(0, -0.05, 0)), r: 0.35, a: (i / 5) * Math.PI * 2 });
    this.say(this.line("bonk")); this.bump(-2, 0);
    setTimeout(() => this.char.react("jump"), 250);
  }

  private pet(amount: number) {
    this.petAcc += amount; this.bump(amount * 0.8, 0);
    const t = this.clock.elapsedTime;
    if (t > this.bubbleUntil - 1) this.say(this.line("pet"));
    if (this.petAcc > 3 && t > this.nextWave) { this.petAcc = 0; this.nextWave = t + 4; this.char.react("wave"); }
  }

  private feed() {
    if (this.busy > 0 || !this.tpl.feed) return;
    this.busy = 2.6; this.ev.onSfx("whoosh");
    const m = this.tpl.feed.clone(); m.position.set(0.7, 3.4, 0.7); m.rotation.y = -0.5; this.scene.add(m);
    let vy = 0; const floorY = STAGE_H;
    const upd: Upd = (_t, dt) => {
      vy -= 12 * dt; m.position.y += vy * dt;
      if (m.position.y < floorY) { m.position.y = floorY; vy = Math.abs(vy) > 1.5 ? -vy * 0.35 : 0; }
    };
    this.updaters.push(upd);
    setTimeout(() => {
      this.updaters.splice(this.updaters.indexOf(upd), 1);
      const from = m.position.clone(), to = this.char.headWorld().add(new THREE.Vector3(0, -0.35, 0.25)), s0 = m.scale.clone();
      this.tweens.add(650, (k) => { m.position.lerpVectors(from, to, k); m.scale.copy(s0).multiplyScalar(1 - k * 0.9); m.rotation.z = k * 1.2; }, () => {
        this.scene.remove(m);
        for (let i = 0; i < 6; i++) this.spawnFx("drop", to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, 0.1)));
        this.say(this.line("feed")); this.bump(4, 22); this.char.react("dance"); this.ev.onSfx("pop");
      }, ease.inOutCubic);
    }, 1100);
  }

  private throwToy() {
    if (this.ball || !this.tpl.toy) return;
    const o = this.tpl.toy.clone(); o.position.set(-3.6, 1.8, 0.9); this.scene.add(o);
    this.ball = { obj: o, v: new THREE.Vector3(3.6, 2.4, 0), jumped: false };
    this.say(this.line("toy")); this.ev.onSfx("whoosh");
  }

  private say(text?: string) {
    const q = text ?? this.cfg.character.quotes[Math.floor(Math.random() * this.cfg.character.quotes.length)];
    if (!q) return;
    this.overlay.bubble.textContent = q; this.overlay.bubble.classList.add("show");
    this.bubbleUntil = this.clock.elapsedTime + 3.2;
    this.nextQuip = this.clock.elapsedTime + 11 + Math.random() * 8;
  }

  private spawnFx(kind: "heart" | "star" | "drop" | "note", at: THREE.Vector3, orbit?: FX["orbit"]) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[kind], transparent: true, depthWrite: false }));
    s.position.copy(at); const sz = kind === "star" ? 0.14 : kind === "drop" ? 0.1 : 0.15 + Math.random() * 0.06; s.scale.setScalar(sz);
    const max = orbit ? 1.6 : 1.1 + Math.random() * 0.4;
    this.fx.push({ s, v: new THREE.Vector3((Math.random() - 0.5) * 0.6, kind === "drop" ? 1.2 : 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3), life: max, max, spin: (Math.random() - 0.5) * 3, orbit });
    this.scene.add(s);
  }

  // ---------------- arkadspel ----------------
  startGame() {
    if (!this.char) return;
    this.panelOpen = false; this.camMode = "arcade";
    this.items.forEach((i) => this.scene.remove(i.obj)); this.items = [];
    this.game = { mode: "ready", score: 0, lives: 3, best: this.game.best }; this.ev.onGame({ ...this.game });
    this.px = this.char.root.position.x; this.goalX = 0; this.spawnAcc = 0;
    this.ev.onSfx("whoosh");
    setTimeout(() => { if (this.game.mode === "ready") { this.game.mode = "play"; this.ev.onGame({ ...this.game }); } }, 1600);
  }
  exitGame() {
    this.game.mode = "off"; this.camMode = "toy"; this.goalX = 0;
    this.items.forEach((i) => this.scene.remove(i.obj)); this.items = [];
    this.ev.onGame({ ...this.game });
  }

  private spawnItem() {
    const G = this.cfg.toy!.game, sc = this.game.score;
    const pBad = Math.min(0.42, 0.24 + sc * 0.004), r = Math.random();
    let obj: THREE.Object3D, kind: Item["kind"], points = 0, rad = 0.35;
    if (r < pBad || r > 0.95) {
      kind = r < pBad ? "bad" : "bonus"; points = kind === "bonus" ? 5 : 0;
      obj = new THREE.Group();
      const col = kind === "bad" ? "#ff3b4f" : "#2ee66b";
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.62, 0.28), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.4 }));
      const wick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), new THREE.MeshStandardMaterial({ color: col }));
      obj.add(body, wick); rad = 0.3;
    } else {
      const k = Math.floor(Math.random() * G.good.length), t = this.tpl.good[k];
      kind = "good"; points = G.good[k].points;
      obj = t ? t.clone() : new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({ color: "#fff" }));
    }
    obj.position.set(THREE.MathUtils.randFloatSpread(STAGE_R * 1.6), 4.1, 0.2);
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    this.scene.add(obj);
    this.items.push({ obj, kind, points, vy: -(1.9 + Math.min(2.8, sc * 0.045) + Math.random() * 0.5), spin: (Math.random() - 0.5) * 4, r: rad });
  }

  private tickGame(dt: number) {
    const g = this.game, root = this.char.root;
    // styrning: tangenter flyttar målet, pekaren sätter det direkt
    const k = this.keys, dir = (k.has("arrowright") || k.has("d") ? 1 : 0) - (k.has("arrowleft") || k.has("a") ? 1 : 0);
    if (dir) this.goalX += dir * 7 * dt;
    const lim = STAGE_R - 0.45;
    this.goalX = THREE.MathUtils.clamp(this.goalX, -lim, lim);
    const dx = this.goalX - this.px, step = Math.sign(dx) * Math.min(Math.abs(dx), 7.5 * dt);
    this.px += step;
    const moving = Math.abs(dx) > 0.05 && g.mode !== "over";
    this.char.st.yaw += ((moving ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : 0) - this.char.st.yaw) * Math.min(1, dt * 14);
    if (moving !== this.walking) { this.walking = moving; this.char.loop(moving && this.char.actions.has("walk") ? "walk" : undefined); }

    if (g.mode === "play") {
      this.spawnAcc += dt;
      const every = Math.max(0.42, 1.05 - g.score * 0.012);
      if (this.spawnAcc > every) { this.spawnAcc = 0; this.spawnItem(); }
    }
    const H = this.cfg.character.height * this.mcapScale;
    for (const it of [...this.items]) {
      it.obj.position.y += it.vy * dt; it.obj.rotation.z += it.spin * dt; it.obj.rotation.y += it.spin * 0.6 * dt;
      const y = it.obj.position.y;
      const hit = g.mode === "play" && Math.abs(it.obj.position.x - this.px) < 0.42 + it.r * 0.5 && y < STAGE_H + H * 0.95 && y > STAGE_H + 0.05;
      if (hit) {
        this.items.splice(this.items.indexOf(it), 1); this.scene.remove(it.obj);
        if (it.kind === "bad") {
          g.lives--; this.squashT = 0; this.ev.onSfx("pop");
          const h = this.char.headWorld(); for (let i = 0; i < 4; i++) this.spawnFx("star", h, { c: h, r: 0.32, a: (i / 4) * Math.PI * 2 });
          if (g.lives <= 0) {
            g.mode = "over"; if (g.score > g.best) { g.best = g.score; store.set("best", String(g.best)); }
            this.say(this.line("gameOver")); this.bump(3, 0);
          }
        } else {
          g.score += it.points; this.bump(0.5, it.kind === "good" ? 1.5 : 0);
          this.spawnFx(it.kind === "bonus" ? "star" : "note", it.obj.position.clone()); this.ev.onSfx("copy");
          if (it.kind === "bonus") this.burst.fire(this.char.headWorld(), 18);
        }
        this.ev.onGame({ ...g });
        continue;
      }
      if (y < -0.5) { this.items.splice(this.items.indexOf(it), 1); this.scene.remove(it.obj); }
    }
  }

  // ---------------- mcap ----------------
  private initMcap() {
    const M = this.cfg.toy!.mcap; if (!M?.milestones.length) return;
    const ms = [...M.milestones].sort((a, b) => a.at - b.at);
    const apply = (mcap: number | null, idxOverride?: number) => {
      const idx = idxOverride ?? (mcap == null ? -1 : ms.reduce((acc, m, i) => (mcap >= m.at ? i : acc), -1));
      const prev = this.mcap.idx;
      const fmt = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`);
      this.mcap = { mcap, idx, label: idx >= 0 ? ms[idx].label : "", next: ms[idx + 1] ? `${ms[idx + 1].label} at ${fmt(ms[idx + 1].at)}` : null, preview: idxOverride != null };
      this.ev.onMcap({ ...this.mcap });
      if (idx > prev && prev >= -1 && this.char) { this.burst.fire(this.char.headWorld(), 40); this.char.react("jump"); if (idx >= 0) this.say(ms[idx].label + "!"); }
    };
    this.mcapMs = ms; this.mcapApply = apply;
    apply(null);
    const ca = this.cfg.ca;
    if (!ca) return;
    const poll = async () => {
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
        const j = await r.json();
        const p = (j.pairs ?? []).sort((a: { liquidity?: { usd?: number } }, b: { liquidity?: { usd?: number } }) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
        const mc = p?.marketCap ?? p?.fdv; if (typeof mc === "number") apply(mc);
      } catch { /* API nere → behåll förra värdet */ }
    };
    poll(); const id = setInterval(poll, 60000); this.disposers.push(() => clearInterval(id));
  }
  private mcapMs: { at: number; scale: number; label: string }[] = [];
  private mcapApply: (m: number | null, i?: number) => void = () => {};
  /** Förhandsvisa nästa milstolpe (före launch / för skojs skull). */
  previewMcap() {
    if (!this.mcapMs.length) return;
    const next = this.mcap.idx + 1 >= this.mcapMs.length ? -1 : this.mcap.idx + 1;
    if (next === -1) { this.mcap.idx = -2; this.mcapApply(null, -1); return; }
    this.mcapApply(this.mcapMs[next].at, next);
  }

  // ---------------- input ----------------
  private bindInput() {
    const dom = this.renderer.domElement;
    const setNdc = (e: PointerEvent) => this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    const overChar = () => { this.ray.setFromCamera(this.ndc, this.camera); const h = this.ray.intersectObject(this.charHit, false)[0]; return h ? h.point : null; };
    const pickProp = () => {
      this.ray.setFromCamera(this.ndc, this.camera);
      const hits = this.ray.intersectObjects(this.interactives.map((i) => i.obj), true);
      for (const h of hits) { let o: THREE.Object3D | null = h.object; while (o) { const f = this.interactives.find((i) => i.obj === o); if (f) return f; o = o.parent; } }
      return null;
    };
    const down = (e: PointerEvent) => { setNdc(e); this.down = { x: e.clientX, y: e.clientY, onChar: !!(this.charHit && overChar()), moved: false, az: this.azGoal }; };
    const move = (e: PointerEvent) => {
      setNdc(e);
      if (this.game.mode !== "off") {
        // arkad: pekaren styr karaktären i sidled
        this.ray.setFromCamera(this.ndc, this.camera); const p = new THREE.Vector3();
        if ((e.pointerType !== "mouse" ? this.down : true) && this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) this.goalX = p.x;
        return;
      }
      const d = this.down; if (!d || !this.entered) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
      if (!d.moved) return;
      const hp = this.charHit ? overChar() : null;
      if (d.onChar && hp) { // klappa
        const t = this.clock.elapsedTime;
        if (t - this.lastPetFx > 0.12) { this.lastPetFx = t; this.spawnFx("heart", hp.clone().add(new THREE.Vector3(0, 0, 0.25))); this.pet(0.35); }
      } else if (!d.onChar) this.azGoal = THREE.MathUtils.clamp(d.az - (e.clientX - d.x) * 0.006, -0.7, 0.7);
    };
    const up = (e: PointerEvent) => {
      const d = this.down; this.down = null; if (!d || !this.entered || this.game.mode !== "off") return;
      setNdc(e);
      if (!d.moved) {
        if (d.onChar) { this.bonk(); return; }
        const p = pickProp(); if (p?.open) { this.ev.onSfx("click"); this.open(p.open); }
      }
    };
    const hover = (e: PointerEvent) => {
      if (!this.entered || this.game.mode !== "off" || isMobile) return;
      setNdc(e); const oc = this.charHit && overChar(); const p = oc ? null : pickProp();
      dom.style.cursor = oc ? "grab" : p ? "pointer" : "default";
      if (p !== this.hovered) { this.hovered = p; if (p) this.ev.onSfx("hover"); }
    };
    const key = (e: KeyboardEvent, isDown: boolean) => {
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "a", "d"].includes(k)) { if (isDown) this.keys.add(k); else this.keys.delete(k); if (this.game.mode !== "off") e.preventDefault(); }
      if (isDown && k === " " && this.game.mode === "over") this.startGame();
    };
    const kd = (e: KeyboardEvent) => key(e, true), ku = (e: KeyboardEvent) => key(e, false);
    const wheel = (e: WheelEvent) => { if (this.entered && this.game.mode === "off") this.zoom = THREE.MathUtils.clamp(this.zoom * (1 + Math.sign(e.deltaY) * 0.07), 0.7, 1.35); };
    const resize = () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); this.post.resize(innerWidth, innerHeight); };
    dom.addEventListener("pointerdown", down); addEventListener("pointermove", move); addEventListener("pointerup", up); dom.addEventListener("pointermove", hover);
    addEventListener("keydown", kd); addEventListener("keyup", ku); dom.addEventListener("wheel", wheel, { passive: true }); addEventListener("resize", resize);
    this.disposers.push(() => {
      dom.removeEventListener("pointerdown", down); removeEventListener("pointermove", move); removeEventListener("pointerup", up); dom.removeEventListener("pointermove", hover);
      removeEventListener("keydown", kd); removeEventListener("keyup", ku); dom.removeEventListener("wheel", wheel); removeEventListener("resize", resize);
    });
  }

  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  }

  // ---------------- frame ----------------
  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    this.tweens.update();
    for (const u of [...this.updaters]) u(t, dt);
    if (!this.char) return;
    const root = this.char.root;
    this.busy -= dt;

    // humöret sjunker sakta
    this.moodAcc += dt;
    if (this.moodAcc > 6) { this.moodAcc = 0; this.bump(-0.8, -1.2); if (this.mood.milk < 25 && this.game.mode === "off" && t > this.bubbleUntil + 4) this.say(this.line("hungry")); }

    if (this.game.mode !== "off") this.tickGame(dt);
    else {
      // tillbaka till mitten och vänd mot kameran
      if (Math.abs(this.px) > 0.02) {
        const s = Math.sign(-this.px) * Math.min(Math.abs(this.px), 4 * dt); this.px += s;
        this.char.st.yaw += ((s > 0 ? Math.PI / 2 : -Math.PI / 2) - this.char.st.yaw) * Math.min(1, dt * 12);
        if (!this.walking) { this.walking = true; this.char.loop(this.char.actions.has("walk") ? "walk" : undefined); }
      } else {
        if (this.walking) { this.walking = false; this.char.loop(); }
        this.char.st.yaw += (0 - this.char.st.yaw) * Math.min(1, dt * 6);
      }
    }

    // garnnystan: studsar över piedestalen, huvudet följer den
    if (this.ball) {
      const b = this.ball, o = b.obj; b.v.y -= 9.8 * dt; o.position.addScaledVector(b.v, dt); o.rotation.z -= b.v.x * dt * 3;
      if (Math.abs(o.position.x) < STAGE_R && o.position.y < STAGE_H) { o.position.y = STAGE_H; b.v.y = Math.abs(b.v.y) * 0.62; }
      if (!b.jumped && o.position.x > -0.3) { b.jumped = true; this.char.react("jump"); this.bump(3, 0); }
      const p = o.position.clone().project(this.camera); this.char.pointer.set(p.x, p.y);
      if (o.position.y < -1) { this.scene.remove(o); this.ball = null; }
    } else if (!this.down && this.game.mode === "off") this.char.pointer.copy(this.ndc);

    // mcap-storlek + bonk-squash
    const ms = this.mcap.idx >= 0 ? this.mcapMs[this.mcap.idx].scale : 1;
    this.mcapScale += (ms - this.mcapScale) * Math.min(1, dt * 2.5);
    let sy = 1, sxz = 1;
    if (this.squashT >= 0) { this.squashT += dt; sy = 1 - 0.3 * Math.exp(-this.squashT * 6) * Math.cos(this.squashT * 20); sxz = 1 / Math.sqrt(sy); if (this.squashT > 1.2) this.squashT = -1; }
    const fy = sy * this.mcapScale, fx = sxz * this.mcapScale;
    root.scale.set(this.baseScale.x * fx, this.baseScale.y * fy, this.baseScale.z * fx);
    this.char.update(t, dt, this.camera);
    // fötterna kvar på piedestalen oavsett skala
    root.position.set(this.px + this.root0.x * fx, STAGE_H - (STAGE_H - this.root0.y) * fy, this.root0.z * fx);
    this.charHit.position.set(this.px, STAGE_H + (this.cfg.character.height * fy) / 2, 0);
    this.charHit.scale.setScalar(this.mcapScale);

    // effekter
    for (const f of [...this.fx]) {
      f.life -= dt; const k = f.life / f.max;
      if (f.orbit) { f.orbit.a += dt * 5; f.s.position.set(f.orbit.c.x + Math.cos(f.orbit.a) * f.orbit.r, f.orbit.c.y + Math.sin(t * 8) * 0.02, f.orbit.c.z + Math.sin(f.orbit.a) * f.orbit.r * 0.5); }
      else { f.s.position.addScaledVector(f.v, dt); f.v.multiplyScalar(0.98); }
      f.s.material.rotation += f.spin * dt; f.s.material.opacity = Math.min(1, k * 2.5);
      if (f.life <= 0) { this.scene.remove(f.s); f.s.material.dispose(); this.fx.splice(this.fx.indexOf(f), 1); }
    }

    // kamera
    this.camK += ((this.camMode === "arcade" ? 1 : 0) - this.camK) * Math.min(1, dt * 3);
    if (!this.down) this.azGoal *= 1 - Math.min(1, dt * 0.4);
    this.az += (this.azGoal - this.az) * Math.min(1, dt * 6);
    const portrait = this.camera.aspect < 1 ? 1.55 : 1;
    const H = this.cfg.character.height * this.mcapScale;
    const toyDist = (3.0 + H * 1.3) * this.zoom * portrait * (this.panelOpen ? 0.92 : 1);
    const toyLook = new THREE.Vector3(0, STAGE_H + H * 0.5, 0);
    const toyPos = new THREE.Vector3(Math.sin(this.az) * toyDist, STAGE_H + H * 0.75 + 0.4 * portrait, Math.cos(this.az) * toyDist);
    if (this.panelOpen && !isMobile) { const r = new THREE.Vector3(Math.cos(this.az), 0, -Math.sin(this.az)).multiplyScalar(toyDist * 0.26); toyLook.add(r); toyPos.add(r); }
    const arcLook = new THREE.Vector3(0, 1.8, 0), arcPos = new THREE.Vector3(0, 1.95, 6.0 * portrait);
    const introPos = new THREE.Vector3(Math.sin(t * 0.25) * 9, 4.5, Math.cos(t * 0.25) * 9 + 2), introLook = new THREE.Vector3(0, 1.2, 0);
    const pos = toyPos.lerp(arcPos, this.camK), look = toyLook.lerp(arcLook, this.camK);
    this.camera.position.lerpVectors(introPos, pos, this.camIntro);
    this.camera.lookAt(introLook.lerp(look, this.camIntro));
    this.camera.updateMatrixWorld();

    // pratbubbla
    if (this.entered && !this.panelOpen && this.game.mode === "off" && t > this.nextQuip && this.nextQuip > 0) this.say();
    if (t > this.bubbleUntil) this.overlay.bubble.classList.remove("show");
    const hp = this.project(this.char.headWorld());
    this.overlay.bubble.style.transform = `translate(${hp.x}px, ${hp.y}px) translate(-50%, -100%)`;

    this.post.tick(t);
    this.post.composer.render(dt);
  }

  dispose() {
    this.renderer.setAnimationLoop(null); this.post.dispose();
    this.disposers.forEach((d) => d());
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
