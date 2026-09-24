import * as THREE from "three";
import type { SiteConfig } from "../types";
import { buildCharacter } from "../core/character";
import { makeLoader, isMobile } from "../core/util";
import { buildIntroFx } from "./fx";

export type Sfx = (k: "hover" | "click" | "whoosh" | "pop" | "copy" | "open" | "clunk" | "static" | "beep" | "warp") => void;

/** DOM-element som intro-motorerna styr direkt (skapas i IntroView). */
export interface IntroDom {
  root: HTMLElement;       // data-attribut för faser (CSS reagerar)
  credits: HTMLElement;    // film: förtexter · vhs/cctv: OSD-rader
  osd: HTMLElement;        // vhs/cctv: tidskod/klocka
  sub: HTMLElement;        // vhs: rad nere till vänster (datum / bandetikett)
  box: HTMLElement;        // cctv: rörelseruta
  bubble: HTMLElement;     // dream: drömbubbla
  bubbleImg: HTMLImageElement;
  dots: HTMLElement;       // dream: tankeprickar
  zzz: HTMLElement;        // dream: z z z
}

export interface IntroHooks {
  /** Introts egna assets är laddade (0..1). */
  onProgress: (p: number) => void;
  /** ENTER kan visas (introt är redo att startas). */
  onEnterable: () => void;
  /** Introt är klart → sajten ska ta över (skyddet: vit blixt/svart/brus ligger kvar och tonas bort av vyn). */
  onDone: () => void;
  sfx: Sfx;
}

export type Char = Awaited<ReturnType<typeof buildCharacter>>;

/** Gemensam grund: egen renderer + scen + kamera, laddar karaktären (idle + klipp), render-loop, städning. */
export abstract class IntroBase {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  fx: ReturnType<typeof buildIntroFx>;
  char!: Char;
  protected clock = new THREE.Clock();
  protected t = 0;          // tid sedan introt började visas
  protected started: number | null = null; // tid när ENTER trycktes
  protected goAt: number | null = null; // tid när allt (intro + sajt) var laddat och förspelet började
  protected finished = false;
  protected pr: number;
  /** >1 spolar fram (används av test-skripten, swiftshader är ~1 fps). */
  timeScale = 1;
  private onResize = () => this.resize();

  constructor(protected host: HTMLElement, protected site: SiteConfig, protected dom: IntroDom, protected hooks: IntroHooks, mode: 0 | 1 | 2, bloom: number) {
    this.pr = Math.min(devicePixelRatio, isMobile ? 1.25 : 1.6);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 2000);
    this.fx = buildIntroFx(this.renderer, this.scene, this.camera, mode, bloom, this.pr);
    addEventListener("resize", this.onResize);
  }

  /** Bygg scenen (miljö + ljus). Karaktären laddas av load(). */
  protected abstract build(): void;
  /** Placera karaktären i scenen när den laddats. */
  protected abstract place(char: Char): void;
  /** Per frame. tt = tid sedan ENTER (eller -1). */
  protected abstract frame(t: number, dt: number, tt: number): void;
  /** ENTER-knappens text. */
  abstract enterLabel(): string;

  async load() {
    this.build();
    const clips = this.site.character.clips ?? [];
    let done = 0; const total = 1 + clips.length;
    const loadGLB = makeLoader(new THREE.LoadingManager());
    const load = async (u: string) => { const r = await loadGLB(u); done++; this.hooks.onProgress(done / total); return r; };
    const c = this.site.character;
    this.char = await buildCharacter({ ...c, pos: [0, 0, 0], rotY: 0, spotlight: undefined, headTrack: c.headTrack ?? true }, load, this.scene, new THREE.Vector3(0, 0, 10));
    this.place(this.char);
    this.hooks.onProgress(1);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.setAnimationLoop(() => this.loop());
    if (import.meta.env.DEV) (window as unknown as { intro: IntroBase }).intro = this;
  }

  private loop() {
    const dt = Math.min(this.clock.getDelta(), 0.05) * this.timeScale;
    this.t += dt;
    const tt = this.started === null ? -1 : Math.max(0, this.t - this.started);
    this.frame(this.t, dt, tt);
    this.char?.update(this.t, dt, this.camera);
    this.camera.updateMatrixWorld();
    this.fx.u.uTime.value = this.t;
    this.fx.composer.render(dt);
  }

  /** Allt är laddat → starta förspelet (filmens tagningar osv.). */
  go() { if (this.goAt === null) { this.goAt = this.t; if (matchMedia("(prefers-reduced-motion: reduce)").matches) this.skip(); } }
  /** Tid sedan go() (0 innan). */
  protected get at() { return this.goAt === null ? 0 : this.t - this.goAt; }

  /** ENTER tryckt. */
  start() { if (this.started === null) this.started = this.t; }
  /** Hoppa över förspelet (t.ex. filmens tagningar) fram till där ENTER visas. */
  skip() { /* överskrids där det finns något att hoppa över */ }

  protected done() { if (this.finished) return; this.finished = true; this.hooks.onDone(); }

  /** Skärmposition för en världspunkt. */
  protected project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, vis: p.z < 1 };
  }

  protected resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight); this.fx.resize();
  }

  dispose() {
    removeEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(null);
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry?.dispose(); } });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
