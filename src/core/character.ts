import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CharacterConfig } from "../types";
import { normalize, fixMaterials, worldBox, frontYaw, DEV } from "./util";
import { blobShadowTexture } from "./textures";

/**
 * Karaktären: Meshy-riggad GLB med idle-loop + reaktionsklipp från extra GLB:er (samma rigg → samma bennamn),
 * eller procedurell animation (andning, gung, hopp) om modellen saknar rigg.
 */
export async function buildCharacter(cfg: CharacterConfig, load: (url: string) => Promise<GLTF | null>, scene: THREE.Object3D, faceTo: THREE.Vector3) {
  const [main, ...extras] = await Promise.all([load(cfg.file), ...(cfg.clips ?? []).map((c) => load(c.file))]);

  const root = new THREE.Group(); root.name = "character";
  let model: THREE.Object3D;
  if (main) {
    // Blender-ögon (Eye/Catch/Lash) ska behålla sin glans – fixMaterials höjer annars roughness
    const keep: [THREE.MeshStandardMaterial, number, number][] = [];
    main.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && /eye|catch|lash/i.test(m.name)) keep.push([m, m.roughness, m.metalness]); });
    model = main.scene; fixMaterials(model);
    keep.forEach(([m, r, mt]) => { m.roughness = r; m.metalness = mt; });
  }
  else if (DEV) model = fallbackBlob();
  else model = new THREE.Group();
  const inner = new THREE.Group(); inner.rotation.y = main ? (cfg.front ? frontYaw(cfg.front) : autoFrontYaw(model)) : 0; inner.add(model);
  root.add(inner);
  scene.add(root);
  normalize(root, cfg.height, cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  const rotY = cfg.rotY ?? Math.atan2(faceTo.x - cfg.pos[0], faceTo.z - cfg.pos[2]);
  root.rotation.y = rotY;
  /** yaw = kroppens riktning (world-formatet vrider den när karaktären går). */
  const st = { yaw: rotY };
  const baseScale = root.scale.clone();
  const baseY = root.position.y;

  // mjuk skugga under fötterna
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(cfg.pos[0], cfg.pos[1] + 0.015, cfg.pos[2]);
  const fb = worldBox(root).getSize(new THREE.Vector3());
  blob.scale.setScalar(Math.max(fb.x, fb.z) * 1.3); scene.add(blob);
  const blobOff = { x: cfg.pos[0] - root.position.x, z: cfg.pos[2] - root.position.z };

  // ---- animation ----
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  const hasNode = (track: THREE.KeyframeTrack) => !!model.getObjectByName(track.name.split(".")[0]);

  (main?.animations ?? []).forEach((clip, i) => actions.set(clip.name || `clip${i}`, mixer.clipAction(clip)));
  (cfg.clips ?? []).forEach((c, i) => {
    const g = extras[i]; if (!g || !g.animations.length) return;
    const clip = g.animations[0].clone(); clip.name = c.name;
    const ok = clip.tracks.filter(hasNode).length / Math.max(1, clip.tracks.length);
    if (ok < 0.5) { console.warn(`[memeroom] klippet ${c.name} matchar inte riggen (${Math.round(ok * 100)}%) — hoppar över`); return; }
    clip.tracks = clip.tracks.filter(hasNode);
    if (cfg.retarget !== false && c.retarget !== false) retargetClip(clip, g.scene, model);
    if (c.inPlace !== false) makeInPlace(clip);
    actions.set(c.name, mixer.clipAction(clip));
  });

  const names = [...actions.keys()];
  const idleName = typeof cfg.idle === "number" ? names[cfg.idle] : cfg.idle && actions.has(cfg.idle) ? cfg.idle : names[0];
  const idle = idleName ? actions.get(idleName)! : null;
  idle?.play();
  let current = idle;
  const rigged = !!idle;
  if (DEV) console.info("[memeroom] karaktärsklipp:", names.join(", ") || "(inga — procedurell animation)");

  // ---- huvud som följer pekaren ----
  let head: THREE.Object3D | null = null;
  if (cfg.headTrack && rigged) model.traverse((o) => { if (!head && /head/i.test(o.name) && !/top|end|nub/i.test(o.name) && (o as THREE.Bone).isBone) head = o; });

  // Om mixern inte skrev över huvudet denna frame (klippet saknar huvudspår) återställer vi förra basen, annars ackumuleras vridningen.
  const lastOut = new THREE.Quaternion(), lastBase = new THREE.Quaternion();

  const pointer = new THREE.Vector2();
  // liv: blinka om modellen har ögon-morphs (Meshy har det inte – ögonen är målade), titta runt när pekaren är still
  const blinks: { m: THREE.Mesh; i: number }[] = [];
  model.traverse((o) => { const m = o as THREE.Mesh; const d = m.morphTargetDictionary; if (!d || !m.morphTargetInfluences) return; for (const [k, i] of Object.entries(d)) if (/blink|eye.?close|close.?eye|eyes?_?closed/i.test(k)) blinks.push({ m, i }); });
  let nextBlink = 2 + Math.random() * 3, blinkT = -1;
  // ---- Blender-ögon: lock som fälls ner (extras blinkAngle), ögonglober som tittar, svans som viftar ----
  const LID_REST = 0.3; // lite sänkta lock = SMOLs deadpan-blick
  const lids: { o: THREE.Object3D; base: THREE.Quaternion; angle: number; close: number }[] = [];
  const eyes: { o: THREE.Object3D; base: THREE.Quaternion }[] = [];
  const tails: { b: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3; i: number }[] = [];
  model.traverse((o) => {
    const ud = o.userData as { blinkAngle?: number };
    if (typeof ud.blinkAngle === "number") lids.push({ o, base: o.quaternion.clone(), angle: ud.blinkAngle, close: ud.blinkAngle });
    else if (/^Eye_[LR]$/.test(o.name)) eyes.push({ o, base: o.quaternion.clone() });
  });
  {
    model.updateMatrixWorld(true);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()));
    const bones: THREE.Bone[] = [];
    model.traverse((o) => { if ((o as THREE.Bone).isBone && /^Tail\d+$/.test(o.name)) bones.push(o as THREE.Bone); });
    bones.sort((a, b) => a.name.localeCompare(b.name));
    bones.forEach((b, i) => {
      const next = bones[i + 1] ?? b.children.find((c) => (c as THREE.Bone).isBone);
      const p0 = b.getWorldPosition(new THREE.Vector3());
      const p1 = next ? next.getWorldPosition(new THREE.Vector3()) : p0.clone().add(new THREE.Vector3(0, 0.05, 0));
      const axisW = new THREE.Vector3().crossVectors(p1.sub(p0).normalize(), side).normalize();
      const pinv = b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      tails.push({ b, rest: b.quaternion.clone(), axis: axisW.applyQuaternion(pinv).normalize(), i });
    });
  }
  // Stängt läge: vrid locket runt sin lokala X tills kalottens mitt (lokal +Z, Blender -Y) pekar dit ögat pekar.
  // Räknas här i stället för att lita på tecknet från Blender (exporten byter axlar).
  for (const l of lids) {
    const eye = eyes.find((e) => e.o.name.slice(-1) === l.o.name.slice(-1) && e.o.parent === l.o.parent);
    if (!eye) continue;
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(l.base), lz = new THREE.Vector3(0, 0, 1).applyQuaternion(l.base);
    const ez = new THREE.Vector3(0, 0, 1).applyQuaternion(eye.base); ez.addScaledVector(ax, -ez.dot(ax)).normalize();
    l.close = Math.atan2(new THREE.Vector3().crossVectors(lz, ez).dot(ax), lz.dot(ez));
  }
  const setLids = (k: number) => lids.forEach((l) => { l.o.visible = k > 0.02; l.o.quaternion.copy(l.base).multiply(q.setFromAxisAngle(xAxis, l.close * k)); });
  const eyeGoal = new THREE.Vector2(), eyeNow = new THREE.Vector2(); let nextEyeMove = 1;
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), fwdZ = new THREE.Vector3(0, 0, 1);
  const lastPtr = new THREE.Vector2(), glance = new THREE.Vector2(); let still = 0, nextGlance = 0;
  let yawSmooth = 0, pitchSmooth = 0;
  let reactionIdx = 0;
  let jumpT = -1;

  /** Spela ett reaktionsklipp (namn, annars nästa i reactions-listan). */
  function react(which?: string) {
    const list = (cfg.reactions ?? []).filter((n) => actions.has(n));
    if (rigged && (list.length || (which && actions.has(which)))) {
      const name = which && actions.has(which) ? which : list[reactionIdx++ % list.length];
      const a = actions.get(name)!;
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.play();
      if (current && current !== a) current.crossFadeTo(a, 0.25, false);
      current = a;
    } else {
      jumpT = 0;
    }
  }
  /** Loopa ett klipp (t.ex. gång); utan namn = tillbaka till idle. */
  function loop(name?: string) {
    const a = name ? actions.get(name) : idle;
    if (!a || a === current) return;
    a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.play();
    if (current) current.crossFadeTo(a, 0.22, false);
    current = a;
  }
  mixer.addEventListener("finished", (e) => {
    if (idle && e.action !== idle && e.action === current) { idle.reset().play(); e.action.crossFadeTo(idle, 0.35, false); current = idle; }
  });

  const q = new THREE.Quaternion(), pq = new THREE.Quaternion(), rq = new THREE.Quaternion();
  const xAxis = new THREE.Vector3(1, 0, 0);
  setLids(LID_REST);
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3();

  function update(t: number, dt: number, camera: THREE.Camera) {
    mixer.update(dt);
    if (blinks.length || lids.length) {
      if (blinkT < 0 && t > nextBlink) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt; const k = blinkT < 0.07 ? blinkT / 0.07 : Math.max(0, 1 - (blinkT - 0.07) / 0.1);
        blinks.forEach((b) => (b.m.morphTargetInfluences![b.i] = k));
        setLids(LID_REST + (1 - LID_REST) * k);
        if (blinkT > 0.17) { blinkT = -1; nextBlink = t + 2.5 + Math.random() * 3; if (Math.random() < 0.2) nextBlink = t + 0.25; setLids(LID_REST); }
      }
    }
    // ögonen tittar mot kameran och flackar lite då och då
    if (eyes.length) {
      if (t > nextEyeMove) { nextEyeMove = t + 1.5 + Math.random() * 2.5; eyeGoal.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.4) * 0.3); if (Math.random() < 0.5) eyeGoal.set(0, 0); }
      eyeNow.lerp(eyeGoal, Math.min(1, dt * 12));
      camera.getWorldPosition(tmpV);
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      for (const e of eyes) {
        const par = e.o.parent!; par.getWorldQuaternion(pq);
        e.o.getWorldPosition(tmpV2);
        const d = tmpV.clone().sub(tmpV2).normalize();
        d.addScaledVector(right, eyeNow.x).addScaledVector(up, eyeNow.y).normalize();
        d.applyQuaternion(pq.clone().invert());                 // → förälderns lokala rum
        const f0 = fwdZ.clone().applyQuaternion(e.base);         // vilobläddring (Blender -Y = glTF +Z)
        const ang = f0.angleTo(d); const lim = 0.32;
        if (ang > lim) d.copy(f0).lerp(d, lim / ang).normalize();
        tmpQ.setFromUnitVectors(f0, d);
        e.o.quaternion.copy(tmpQ).multiply(e.base);
      }
    }
    // svansen viftar (benen finns inte i klippen → vi styr dem helt)
    for (const tb of tails) {
      const w = Math.sin(t * 2.4 - tb.i * 0.7) * (0.12 + tb.i * 0.05) + Math.sin(t * 0.9 + tb.i) * 0.05;
      tb.b.quaternion.copy(q.setFromAxisAngle(tb.axis, w)).multiply(tb.rest);
    }
    // pekaren stilla en stund → karaktären tittar sig omkring på egen hand
    if (pointer.distanceToSquared(lastPtr) > 1e-6) { still = 0; lastPtr.copy(pointer); glance.set(0, 0); } else still += dt;
    if (still > 4 && t > nextGlance) { nextGlance = t + 2 + Math.random() * 3; glance.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 0.6); if (Math.random() < 0.35) glance.set(0, 0); }
    const looking = still > 4 && !!head; const px = looking ? glance.x : pointer.x, py = looking ? glance.y : pointer.y;
    // hela kroppen vrider sig lite mot pekaren
    yawSmooth += (px * 0.35 - yawSmooth) * Math.min(1, dt * (looking ? 1.5 : 3));
    pitchSmooth += (-py * 0.18 - pitchSmooth) * Math.min(1, dt * (looking ? 1.5 : 3));
    root.rotation.y = st.yaw + yawSmooth * (head ? 0.35 : 0.6);
    blob.position.x = root.position.x + blobOff.x; blob.position.z = root.position.z + blobOff.z;

    if (head) {
      const h = head as THREE.Object3D;
      if (h.quaternion.equals(lastOut)) h.quaternion.copy(lastBase);
      lastBase.copy(h.quaternion);
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      rq.setFromAxisAngle(up, yawSmooth * 0.9).multiply(q.setFromAxisAngle(right, pitchSmooth));
      h.parent!.getWorldQuaternion(pq);
      // local' = P^-1 * R * P * L
      const local = pq.clone().invert().multiply(rq).multiply(pq).multiply(h.quaternion);
      h.quaternion.copy(local);
      lastOut.copy(local);
    }

    if (!rigged) {
      // procedurellt: andas + gungar, hopp vid klick
      const breathe = 1 + Math.sin(t * 2.2) * 0.018;
      let sy = breathe, sxz = 1 / Math.sqrt(breathe), lift = Math.sin(t * 1.1) * 0.02;
      if (jumpT >= 0) {
        jumpT += dt; const k = jumpT / 0.7;
        if (k < 0.15) { const s = k / 0.15; sy *= 1 - 0.18 * s; sxz *= 1 + 0.12 * s; }
        else if (k < 1) { const s = (k - 0.15) / 0.85; lift += Math.sin(s * Math.PI) * cfg.height * 0.35; root.rotation.y += s * Math.PI * 2; sy *= 1 + 0.08 * Math.sin(s * Math.PI); }
        else jumpT = -1;
      }
      root.scale.set(baseScale.x * sxz, baseScale.y * sy, baseScale.z * sxz);
      root.position.y = baseY + Math.max(0, lift);
      blob.material.opacity = 1 - Math.min(0.6, lift);
    }
  }

  function headWorld() { const b = worldBox(root); return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.15, (b.min.z + b.max.z) / 2); }

  return { root, update, react, loop, st, pointer, headWorld, rigged, clipNames: names, mixer, actions };
}

/**
 * Retarget: klippet kommer från ett ANNAT riggjobb (samma bennamn men andra vilo-orienteringar/bone roll).
 * Per nyckelbild: D = källbenets rotation i riggrummet × källans vilo-rotation⁻¹ ; målbenet får D × sin egen vilo-rotation,
 * omräknat till lokalt rum via målets (redan retargetade) förälder. Höftens förflyttning förs över som delta, skalad.
 * Om vilo-poserna redan är lika blir resultatet identiskt med originalet.
 */
function retargetClip(clip: THREE.AnimationClip, srcRoot: THREE.Object3D, dstRoot: THREE.Object3D) {
  const Q = THREE.Quaternion;
  const byName = (root: THREE.Object3D) => { const m = new Map<string, THREE.Object3D>(); root.traverse((o) => { if (o.name && !m.has(o.name)) m.set(o.name, o); }); return m; };
  const S = byName(srcRoot), Dn = byName(dstRoot);
  const qTracks = new Map<string, THREE.KeyframeTrack>(); const pTracks = new Map<string, THREE.KeyframeTrack>();
  for (const tr of clip.tracks) { const [n, prop] = tr.name.split("."); if (prop === "quaternion") qTracks.set(n, tr); else if (prop === "position") pTracks.set(n, tr); }
  if (!qTracks.size) return;
  // tider: längsta kvaterniontracket
  let times = [...qTracks.values()][0].times; for (const t of qTracks.values()) if (t.times.length > times.length) times = t.times;
  const interp = new Map<string, THREE.Interpolant>(); qTracks.forEach((t, n) => interp.set(n, t.createInterpolant()));
  const restWorld = (o: THREE.Object3D, root: THREE.Object3D) => { const q = new Q(); const chain: THREE.Object3D[] = []; for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) chain.unshift(p); chain.forEach((c) => q.multiply(c.quaternion)); return q; };
  const srcRestW = new Map<string, THREE.Quaternion>(); S.forEach((o, n) => srcRestW.set(n, restWorld(o, srcRoot)));
  const dstRestW = new Map<string, THREE.Quaternion>(); Dn.forEach((o, n) => dstRestW.set(n, restWorld(o, dstRoot)));
  // målbenen i hierarkiordning (föräldrar först), bara de som finns i källan
  const order: THREE.Object3D[] = []; dstRoot.traverse((o) => { if (o !== dstRoot && S.has(o.name)) order.push(o); });
  const out = new Map<string, number[]>(); order.forEach((o) => out.set(o.name, []));
  const srcW = new Map<string, THREE.Quaternion>(), dstW = new Map<string, THREE.Quaternion>();
  const tmp = new Q(), D = new Q();
  const srcWorldAt = (o: THREE.Object3D): THREE.Quaternion => {
    const c = srcW.get(o.name); if (c) return c;
    const local = interp.has(o.name) ? tmp.fromArray(interp.get(o.name)!.evaluate(curT) as unknown as number[]).clone() : o.quaternion.clone();
    const par = o.parent && o.parent !== srcRoot ? srcWorldAt(o.parent) : new Q();
    const w = par.clone().multiply(local); srcW.set(o.name, w); return w;
  };
  let curT = 0;
  for (const t of times) {
    curT = t; srcW.clear(); dstW.clear();
    for (const o of order) {
      const s = S.get(o.name)!;
      D.copy(srcWorldAt(s)).multiply(srcRestW.get(o.name)!.clone().invert());
      const want = D.clone().multiply(dstRestW.get(o.name)!);
      const parW = o.parent && o.parent !== dstRoot ? (dstW.get(o.parent.name) ?? dstRestW.get(o.parent.name) ?? new Q()) : new Q();
      const local = parW.clone().invert().multiply(want);
      dstW.set(o.name, want);
      out.get(o.name)!.push(local.x, local.y, local.z, local.w);
    }
  }
  const tracks: THREE.KeyframeTrack[] = [];
  out.forEach((v, n) => tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, Array.from(times), v)));
  // höften: förflyttning som delta från källans vila, skalad till målets
  pTracks.forEach((tr, n) => {
    if (!/hips|pelvis/i.test(n)) return;
    const s = S.get(n), d = Dn.get(n); if (!s || !d) return;
    const k = s.position.length() > 1e-6 ? d.position.length() / s.position.length() : 1;
    const v = Array.from(tr.values);
    for (let i = 0; i < v.length; i += 3) { v[i] = d.position.x + (v[i] - s.position.x) * k; v[i + 1] = d.position.y + (v[i + 1] - s.position.y) * k; v[i + 2] = d.position.z + (v[i + 2] - s.position.z) * k; }
    tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`, Array.from(tr.times), v));
  });
  clip.tracks = tracks;
  clip.resetDuration();
}

/** Nolla rotbenets X/Z-förflyttning så gång/dans stannar på plats. */
function makeInPlace(clip: THREE.AnimationClip) {
  for (const tr of clip.tracks) {
    if (!tr.name.endsWith(".position") || !/hips|root|pelvis|armature/i.test(tr.name)) continue;
    const v = tr.values; const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
}

/** Platshållare i dev när ingen GLB finns: en söt blobb med ögon. */
function fallbackBlob() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.6, 8, 24), new THREE.MeshStandardMaterial({ color: "#ffd166", roughness: 0.5 }));
  body.position.y = 0.75; body.castShadow = true; g.add(body);
  const eyeM = new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.3 });
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), eyeM); e.position.set(0.16 * s, 1.0, 0.4); g.add(e); }
  return g;
}

/**
 * Meshy-riggar har benen Head + headfront: vektorn mellan dem pekar åt ansiktet i vilopose.
 * Returnerar yaw som vrider modellen så ansiktet pekar mot +Z. Saknas benen → anta +Z.
 */
function autoFrontYaw(model: THREE.Object3D) {
  const head = model.getObjectByName("Head"), front = model.getObjectByName("headfront");
  if (!head || !front) return 0;
  model.updateMatrixWorld(true);
  const inv = model.matrixWorld.clone().invert();
  const d = front.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv).sub(head.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv));
  if (Math.hypot(d.x, d.z) < 1e-6) return 0;
  return -Math.atan2(d.x, d.z);
}
