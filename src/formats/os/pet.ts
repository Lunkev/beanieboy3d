import * as THREE from "three";
import type { CharacterConfig } from "../../types";
import { buildCharacter } from "../../core/character";
import { makeLoader, worldBox } from "../../core/util";

/**
 * Desktop-pet: karaktären vandrar fram och tillbaka ovanför aktivitetsfältet (Shimeji-stil).
 * Transparent helskärms-canvas utan pekarhändelser; klick fångas via en osynlig träff-div som följer karaktären.
 */
export class Pet {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(0, 1, 1, 0, -50, 50);
  char!: Awaited<ReturnType<typeof buildCharacter>>;
  private clock = new THREE.Clock();
  private x = 200; private target = 400; private pause = 2; private dir = 1;
  private walk: THREE.AnimationAction | null = null;
  private idle: THREE.AnimationAction | null = null;
  private busyUntil = 0;
  private px = 1; // pixlar per världsenhet

  constructor(private host: HTMLElement, private hit: HTMLElement, private cfg: CharacterConfig, private heightPx: number, private walkClip: string | undefined, private bottom: () => number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#555577", 1.4));
    const key = new THREE.DirectionalLight("#fff4e6", 2.4); key.position.set(1, 3, 4); this.scene.add(key);
    addEventListener("resize", this.resize);
  }

  async load() {
    const load = makeLoader(new THREE.LoadingManager());
    this.char = await buildCharacter({ ...this.cfg, pos: [0, 0, 0], rotY: 0, height: 1, headTrack: false, spotlight: undefined }, load, this.scene, new THREE.Vector3(0, 0, 10));
    // blob-skuggan ligger direkt i scenen — göm den (ser konstig ut i ortografisk sidovy)
    this.scene.children.forEach((c) => { if ((c as THREE.Mesh).isMesh) c.visible = false; });
    this.walk = this.walkClip ? this.char.actions.get(this.walkClip) ?? null : null;
    this.idle = [...this.char.actions.values()][0] ?? null;
    this.x = innerWidth * 0.3; this.target = this.x;
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize = () => {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.px = this.heightPx; // karaktären är 1 enhet hög
    this.camera.left = 0; this.camera.right = w / this.px; this.camera.top = h / this.px; this.camera.bottom = 0;
    this.camera.position.set(0, 0, 10); this.camera.updateProjectionMatrix();
  };

  react() {
    this.busyUntil = this.clock.elapsedTime + 2.2;
    this.walk?.stop(); this.char.react();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    const floor = this.bottom();
    if (t > this.busyUntil) {
      const moving = Math.abs(this.target - this.x) > 4;
      if (moving) {
        this.dir = Math.sign(this.target - this.x);
        this.x += this.dir * 70 * dt;
        if (this.walk && !this.walk.isRunning()) { this.idle?.fadeOut(0.2); this.walk.reset().fadeIn(0.2).play(); }
      } else {
        if (this.walk?.isRunning()) { this.walk.fadeOut(0.25); this.idle?.reset().fadeIn(0.25).play(); }
        this.pause -= dt;
        if (this.pause <= 0) { this.target = 60 + Math.random() * (innerWidth - 120); this.pause = 2 + Math.random() * 5; }
      }
    }
    const r = this.char.root;
    r.position.set(this.x / this.px, floor / this.px, 0);
    // vänd i gångriktningen, men titta mot oss när den står still
    const want = Math.abs(this.target - this.x) > 4 && t > this.busyUntil ? this.dir * Math.PI / 2 : 0;
    r.rotation.y += (want - r.rotation.y) * Math.min(1, dt * 6);
    this.char.mixer.update(dt);
    if (!this.walk && Math.abs(this.target - this.x) > 4) r.position.y += Math.abs(Math.sin(t * 9)) * 0.04; // studs om gång-klipp saknas
    this.renderer.render(this.scene, this.camera);
    // träffytan följer
    const b = worldBox(r);
    this.hit.style.transform = `translate(${b.min.x * this.px}px, ${innerHeight - b.max.y * this.px}px)`;
    this.hit.style.width = `${(b.max.x - b.min.x) * this.px}px`; this.hit.style.height = `${(b.max.y - b.min.y) * this.px}px`;
  }

  headScreen() { const b = worldBox(this.char.root); return { x: ((b.min.x + b.max.x) / 2) * this.px, y: innerHeight - b.max.y * this.px }; }

  dispose() { removeEventListener("resize", this.resize); this.renderer.setAnimationLoop(null); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
