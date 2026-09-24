import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CharacterConfig } from "../../types";
import { buildCharacter } from "../../core/character";
import { makeLoader, worldBox } from "../../core/util";

export type ViewMode = "textured" | "toon" | "wire" | "normals";

/**
 * Liten 3D-visare för ett OS-fönster: karaktären på en snurrplatta, orbit, flip X/Y, visningslägen, djup (fov), klipp.
 * Egen renderer (alpha) så den kan ligga i ett HTML-fönster.
 */
export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  controls: OrbitControls;
  char!: Awaited<ReturnType<typeof buildCharacter>>;
  private clock = new THREE.Clock();
  private flip = new THREE.Group();
  private spin = true;
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private ro: ResizeObserver;

  constructor(private host: HTMLElement, private cfg: CharacterConfig, bg: [string, string]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    host.appendChild(this.renderer.domElement);
    host.style.background = `radial-gradient(circle at 50% 35%, ${bg[0]}, ${bg[1]})`;
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#444466", 1.1));
    const key = new THREE.DirectionalLight("#fff4e6", 2.2); key.position.set(2, 4, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight("#9fc4ff", 1.2); rim.position.set(-3, 2, -3); this.scene.add(rim);
    // snurrplatta
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.08, 48), new THREE.MeshStandardMaterial({ color: "#1b1b24", metalness: 0.5, roughness: 0.35 }));
    disc.position.y = -0.04; this.scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.012, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2), toneMapped: false }));
    ring.rotation.x = Math.PI / 2; this.scene.add(ring);
    this.scene.add(this.flip);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.enablePan = false;
    this.controls.minDistance = 1.2; this.controls.maxDistance = 6;
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
  }

  async load(onDone?: () => void) {
    const load = makeLoader(new THREE.LoadingManager());
    const c = { ...this.cfg, pos: [0, 0, 0] as [number, number, number], height: 1.1, rotY: 0, headTrack: false };
    this.char = await buildCharacter(c, load, this.flip, new THREE.Vector3(0, 0, 5));
    const b = worldBox(this.char.root);
    this.controls.target.set(0, b.getCenter(new THREE.Vector3()).y, 0);
    this.camera.position.set(0, b.max.y * 0.8, 3.1);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
    onDone?.();
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%"; this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    if (this.spin) this.flip.rotation.y += dt * 0.6;
    this.char?.update(t, dt, this.camera);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  toggleSpin() { this.spin = !this.spin; return this.spin; }
  flipX() { this.flip.scale.x *= -1; }
  flipY() {
    // upp och ner runt karaktärens mitt
    const b = worldBox(this.char.root); const cy = (b.min.y + b.max.y) / 2;
    this.flip.rotation.z = this.flip.rotation.z ? 0 : Math.PI;
    this.flip.position.y = this.flip.rotation.z ? cy * 2 : 0;
  }
  depth(fov: number) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  play(name: string) {
    const a = this.char.actions.get(name); if (!a) { this.char.react(); return; }
    this.char.mixer.stopAllAction(); a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
    const idle = [...this.char.actions.values()][0];
    const done = (e: { action: THREE.AnimationAction }) => { if (e.action === a) { idle.reset().play(); this.char.mixer.removeEventListener("finished", done); } };
    this.char.mixer.addEventListener("finished", done);
  }
  mode(m: ViewMode) {
    this.char.root.traverse((o) => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      if (!this.originals.has(mesh)) this.originals.set(mesh, mesh.material);
      const orig = this.originals.get(mesh)!;
      const base = (Array.isArray(orig) ? orig[0] : orig) as THREE.MeshStandardMaterial;
      if (m === "textured") mesh.material = orig;
      else if (m === "toon") mesh.material = new THREE.MeshToonMaterial({ map: base.map ?? null, color: base.color });
      else if (m === "wire") mesh.material = new THREE.MeshBasicMaterial({ color: "#7CFFB2", wireframe: true });
      else mesh.material = new THREE.MeshNormalMaterial();
    });
  }
  dispose() { this.ro.disconnect(); this.renderer.setAnimationLoop(null); this.controls.dispose(); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
