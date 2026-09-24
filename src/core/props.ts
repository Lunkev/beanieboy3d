import * as THREE from "three";
import type { PropConfig } from "../types";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Interactive } from "./interactive";
import { normalize, ground, fixMaterials, worldBox, placeholder, frontYaw, DEV } from "./util";

export async function buildProps(
  props: PropConfig[],
  load: (url: string) => Promise<GLTF | null>,
  scene: THREE.Scene,
  halo: (color: string, size: number) => THREE.Sprite,
) {
  const byId = new Map<string, THREE.Object3D>();
  const interactives: Interactive[] = [];
  const updaters: ((t: number, dt: number) => void)[] = [];
  const editables: { id: string; obj: THREE.Object3D }[] = [];

  const loaded = await Promise.all(props.map((p) => load(p.file)));

  props.forEach((p, i) => {
    const gltf = loaded[i];
    let obj: THREE.Object3D;
    if (gltf) {
      obj = gltf.scene;
      fixMaterials(obj);
    } else if (DEV) {
      obj = placeholder(p.id);
    } else return;

    // inner vrider modellens framsida till +Z, wrap vrider sedan hela propen till rotY
    const inner = new THREE.Group(); inner.add(obj); inner.rotation.y = gltf ? frontYaw(p.front ?? "+x") : 0;
    const wrap = new THREE.Group(); wrap.name = "prop:" + p.id; wrap.add(inner);
    scene.add(wrap);
    normalize(wrap, p.height, 0, 0, 0);
    wrap.rotation.y = p.rotY ?? 0;
    let y = p.pos[1];
    if (p.onTop && byId.has(p.onTop)) y = worldBox(byId.get(p.onTop)!).max.y - 0.005;
    ground(wrap, p.pos[0], y, p.pos[2]);
    byId.set(p.id, wrap);
    editables.push({ id: p.id, obj: wrap });

    if (p.glow) {
      const b = worldBox(wrap), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
      const light = new THREE.PointLight(p.glow, 2.4, 5, 1.6); light.position.copy(c); scene.add(light);
      const h = halo(p.glow, Math.max(s.x, s.y, s.z) * 2.2); h.position.copy(c); scene.add(h);
      updaters.push((t) => { const k = 0.85 + Math.sin(t * 2.1 + i) * 0.15; light.intensity = 2.4 * k; h.material.opacity = k; });
    }
    if (p.float) {
      const baseY = wrap.position.y;
      updaters.push((t) => { wrap.position.y = baseY + 0.08 + Math.sin(t * 1.4 + i) * 0.06; wrap.rotation.y = (p.rotY ?? 0) + t * 0.35; });
    }
    if (p.open || p.label) interactives.push({ obj: wrap, open: p.open, label: p.label, id: p.id });
  });

  return { byId, interactives, updaters, editables };
}
