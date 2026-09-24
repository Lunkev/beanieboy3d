import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { Engine } from "./RoomEngine";

/**
 * ?edit — flytta/rotera/skala allt i rummet med musen och kopiera layouten till site.config.ts.
 * Klick = välj · W flytta · E rotera · R skala · Esc släpp · C kopiera layout (JSON) + kameravy.
 */
export function startEdit(eng: Engine, editables: { id: string; obj: THREE.Object3D }[]) {
  const tc = new TransformControls(eng.camera, eng.renderer.domElement);
  tc.setSize(0.8);
  eng.scene.add(tc.getHelper());
  tc.addEventListener("dragging-changed", (e) => { eng.controls.enabled = !(e as unknown as { value: boolean }).value; });

  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:99;background:#000c;color:#fff;font:12px/1.5 ui-monospace,monospace;padding:10px 12px;border-radius:8px;max-width:360px;pointer-events:none";
  box.innerHTML = "<b>EDIT</b> klick=välj · W/E/R · Esc · <b>C</b>=kopiera layout<br><span id=edsel>—</span>";
  document.body.appendChild(box);
  const sel = box.querySelector("#edsel") as HTMLElement;

  const ray = new THREE.Raycaster(), v = new THREE.Vector2();
  eng.renderer.domElement.addEventListener("dblclick", (e) => {
    v.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(v, eng.camera);
    const hits = ray.intersectObjects(editables.map((x) => x.obj), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) { const ed = editables.find((x) => x.obj === o); if (ed) { tc.attach(ed.obj); sel.textContent = ed.id; return; } o = o.parent; }
    }
  });
  addEventListener("keydown", (e) => {
    if (e.key === "w") tc.setMode("translate");
    if (e.key === "e") tc.setMode("rotate");
    if (e.key === "r") tc.setMode("scale");
    if (e.key === "Escape") { tc.detach(); sel.textContent = "—"; }
    if (e.key === "c") {
      const r = (n: number) => Math.round(n * 100) / 100;
      const out = {
        camera: { pos: eng.camera.position.toArray().map(r), target: eng.controls.target.toArray().map(r) },
        objects: editables.map(({ id, obj }) => ({ id, pos: obj.position.toArray().map(r), rotY: r(obj.rotation.y), scale: r(obj.scale.x) })),
      };
      const json = JSON.stringify(out, null, 1);
      navigator.clipboard?.writeText(json).catch(() => {});
      console.log(json);
      sel.textContent = "layout kopierad (och i konsolen)";
    }
  });
  eng.controls.enabled = true;
}
