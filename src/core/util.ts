import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export const isMobile = typeof window !== "undefined" && (matchMedia("(pointer: coarse)").matches || innerWidth < 760);
export const DEV = import.meta.env.DEV;

export const ease = {
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
};

/** Enkla tweens som drivs av motorns render-loop. */
export class Tweens {
  private list: { t0: number; dur: number; fn: (k: number) => void; done?: () => void; ease: (t: number) => void | number }[] = [];
  add(dur: number, fn: (k: number) => void, done?: () => void, e: (t: number) => number = ease.inOutCubic) {
    this.list.push({ t0: performance.now(), dur, fn, done, ease: e });
  }
  update() {
    const now = performance.now();
    this.list = this.list.filter((tw) => {
      const t = Math.min((now - tw.t0) / tw.dur, 1);
      tw.fn(tw.ease(t) as number);
      if (t >= 1) { tw.done?.(); return false; }
      return true;
    });
  }
}

export function makeLoader(manager: THREE.LoadingManager) {
  const loader = new GLTFLoader(manager);
  return (url: string) => new Promise<GLTF | null>((res) => {
    loader.load(url, res, undefined, (err) => { console.warn("[memeroom] kunde inte ladda", url, err); res(null); });
  });
}

/** Skala till målhöjd och ställ objektet med fötterna på y, centrerat på x/z. */
export function normalize(obj: THREE.Object3D, height: number, x: number, y: number, z: number) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const s = b.getSize(new THREE.Vector3());
  if (s.y > 0) obj.scale.multiplyScalar(height / s.y);
  obj.updateMatrixWorld(true);
  ground(obj, x, y, z);
}

export function ground(obj: THREE.Object3D, x: number, y: number, z: number) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const c = b.getCenter(new THREE.Vector3());
  obj.position.x += x - c.x;
  obj.position.z += z - c.z;
  obj.position.y += y - b.min.y;
  obj.updateMatrixWorld(true);
}

/** Meshy/Tripo-GLB:er har ibland metalness=1 eller helt blanka material som blir svarta utan envmap. */
export function fixMaterials(obj: THREE.Object3D, shadows = true) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = shadows; m.receiveShadow = true;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (sm.isMeshStandardMaterial) {
        if (!sm.metalnessMap) sm.metalness = Math.min(sm.metalness, 0.25);
        sm.roughness = Math.max(sm.roughness, 0.45);
        sm.envMapIntensity = 0.9;
      }
    }
  });
}

export function worldBox(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}

export function placeholder(label: string, color = "#ff4fa3") {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color, roughness: 0.6, wireframe: false, transparent: true, opacity: 0.6 }));
  m.position.y = 0.3; g.add(m); g.name = "placeholder:" + label;
  return g;
}

export function rand(a: number, b: number) { return a + Math.random() * (b - a); }

/** Yaw som vrider en modell med given framsida så att den tittar mot +Z. */
export function frontYaw(front: "+x" | "-x" | "+z" | "-z" = "+z") {
  return { "+z": 0, "-z": Math.PI, "+x": -Math.PI / 2, "-x": Math.PI / 2 }[front];
}
