import * as THREE from "three";
import { IntroBase, type Char, type IntroDom, type IntroHooks } from "./base";
import type { SiteConfig } from "../types";
import { glowTexture } from "../core/textures";
import { worldBox, isMobile } from "../core/util";
import { swellAmbience } from "../ui/sfx";

const SHOT_B = 4.2, SHOT_C = 8.4, ENTER_AT = 10.2, WARP = 2.6;
const smooth = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

/**
 * Film-intro: karaktären står på en klippa vid havet i solnedgång.
 * Tre regisserade tagningar (hårda klipp, mjuk följning) → titel + glas-ENTER → warp (fov, bloom, exponering, radiell blur) → vit blixt.
 */
export class FilmIntro extends IntroBase {
  private F = new THREE.Vector3();
  private H = 1;
  private shot = -1;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private look = new THREE.Vector3();
  private enterShown = false;
  private sunDir = new THREE.Vector3(0.12, 0.08, -1).normalize();
  private upd: ((t: number, dt: number) => void)[] = [];
  private pointer = new THREE.Vector2();
  private glanceAt = new THREE.Vector2(0.9, 0.1);
  private onMove = (e: PointerEvent) => this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);

  constructor(host: HTMLElement, site: SiteConfig, dom: IntroDom, hooks: IntroHooks) {
    super(host, site, dom, hooks, 0, 0.42);
    addEventListener("pointermove", this.onMove);
  }

  enterLabel() { return this.site.intro?.enter ?? "ENTER"; }

  protected build() {
    const C = this.site.intro?.film ?? { sky: ["#3f6fb5", "#ffb46b"], sea: "#1f8fc4", sun: "#fff1c9", land: "#5d9a4a" };
    const s = this.scene;
    const horizon = new THREE.Color(C.sky[1]);
    s.fog = new THREE.Fog(horizon, 120, 900);

    // himmel: gradient + solglöd + penseldragna molnstrimmor
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(C.sky[0]) }, hor: { value: horizon }, sun: { value: new THREE.Color(C.sun) }, dir: { value: this.sunDir }, uT: { value: 0 } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: `uniform vec3 top, hor, sun, dir; uniform float uT; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          float y = vP.y; vec3 c = mix(hor, top, smoothstep(-.02, .55, y));
          float s = max(dot(vP, dir), 0.);
          c += sun * (pow(s, 900.) * 3. + pow(s, 24.) * .55 + pow(s, 4.) * .18);
          vec2 q = vec2(atan(vP.z, vP.x) * 3., y * 22.) + vec2(uT * .004, 0.);
          float cl = n(q * vec2(1.2, 1.)) * .6 + n(q * 2.7) * .4; cl = smoothstep(.55, .85, cl) * smoothstep(.02, .12, y) * (1. - smoothstep(.3, .5, y));
          c = mix(c, mix(c * 1.12, sun * 1.05, pow(s, 3.)), cl * .75);
          c = mix(c, hor * 1.05, smoothstep(.06, -.02, y));
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 24), skyMat); s.add(sky);
    this.upd.push((t) => { skyMat.uniforms.uT.value = t; });
    const sunS = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(C.sun), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    sunS.position.copy(this.sunDir).multiplyScalar(1100); sunS.scale.setScalar(260); s.add(sunS);

    // hav: vågor i vertex, färgband + solglitter i fragment
    const seaMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: { c0: { value: new THREE.Color(C.sea) }, hor: { value: horizon }, sun: { value: new THREE.Color(C.sun) }, dir: { value: this.sunDir }, uT: { value: 0 }, cam: { value: new THREE.Vector3() } },
      vertexShader: `uniform float uT; varying vec3 vW; varying float vH;
        void main(){ vec3 p = position; float w = sin(p.x*.05 + uT*.9)*.6 + sin(p.y*.07 - uT*1.1)*.5 + sin((p.x+p.y)*.13 + uT*1.7)*.2; p.z += w; vH = w;
          vec4 wp = modelMatrix * vec4(p, 1.); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 c0, hor, sun, dir, cam; uniform float uT; varying vec3 vW; varying float vH;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          float k = n(vW.xz * .045 + vec2(uT * .05, 0.)) * .7 + vH * .25;
          vec3 c = c0; c = mix(c, c0 * 1.35 + .06, step(.55, k)); c = mix(c, vec3(.92, .97, 1.), step(.86, k) * .7);
          vec3 v = normalize(cam - vW); float d = length(cam - vW);
          vec3 r = reflect(-v, vec3(0., 1., 0.)); float g = pow(max(dot(r, dir), 0.), 40.);
          float sp = step(.82, h(floor(vW.xz * 1.6) + floor(uT * 6.)));
          c += sun * g * (.5 + sp * 2.2);
          c = mix(c, hor, smoothstep(160., 1200., d));
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 160, 160), seaMat); sea.rotation.x = -Math.PI / 2; sea.position.y = -16; s.add(sea);
    this.upd.push((t) => { seaMat.uniforms.uT.value = t; seaMat.uniforms.cam.value.copy(this.camera.position); });

    // klippa med gräs på toppen
    const rock = new THREE.MeshStandardMaterial({ color: "#9a8069", roughness: 1, flatShading: true });
    const grass = new THREE.MeshStandardMaterial({ color: C.land, roughness: 0.95, flatShading: true });
    const cg = new THREE.CylinderGeometry(7.5, 10, 16, 14, 5); const cp = cg.attributes.position as THREE.BufferAttribute;
    const jit = new Map<string, number>();
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i); if (y > 7.9) continue;
      const key = `${cp.getX(i).toFixed(2)},${y.toFixed(2)},${cp.getZ(i).toFixed(2)}`;
      if (!jit.has(key)) jit.set(key, 1 + (Math.random() - 0.5) * 0.22);
      const k = jit.get(key)!; cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k);
    }
    cg.computeVertexNormals();
    const cliff = new THREE.Mesh(cg, [rock, grass, rock]); cliff.position.set(0, -8, 3.5); cliff.receiveShadow = true; s.add(cliff);
    // grästuvor som vajar
    const tuftMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true });
    const uT = { value: 0 };
    tuftMat.onBeforeCompile = (sh) => { sh.uniforms.uT = uT; sh.vertexShader = "uniform float uT;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n float sw = sin(uT*2.2 + instanceMatrix[3].x*1.7 + instanceMatrix[3].z) * .09 * (position.y + .15);\n transformed.x += sw; transformed.z += sw*.5;"); };
    const N = isMobile ? 160 : 320, tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 0.34, 4), tuftMat, N);
    const d = new THREE.Object3D(), g1 = new THREE.Color(C.land), g2 = new THREE.Color(C.land).multiplyScalar(0.72);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 7;
      d.position.set(Math.cos(a) * r, 0.15, 3.5 + Math.sin(a) * r); d.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 3, (Math.random() - 0.5) * 0.4); d.scale.setScalar(0.6 + Math.random() * 0.8); d.updateMatrix();
      tufts.setMatrixAt(i, d.matrix); tufts.setColorAt(i, g1.clone().lerp(g2, Math.random()));
    }
    s.add(tufts); this.upd.push((t) => { uT.value = t; });
    // några träd bakom (djup i tagning A/B)
    const leaf = new THREE.MeshStandardMaterial({ color: new THREE.Color(C.land).multiplyScalar(0.8), roughness: 1, flatShading: true });
    const trunk = new THREE.MeshStandardMaterial({ color: "#6b4a33", roughness: 1 });
    for (const [x, z, h] of [[-4.2, 6.5, 3.4], [3.6, 7.5, 4.2], [-1.5, 9, 3], [5.5, 4.5, 2.6]]) {
      const tr = new THREE.Group();
      const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, h * 0.45, 6), trunk); tk.position.y = h * 0.22; tr.add(tk);
      const cr = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.32, 0), leaf); cr.position.y = h * 0.62; cr.scale.y = 1.2; cr.castShadow = true; tr.add(cr);
      tr.position.set(x, 0, z); s.add(tr);
    }
    // öar i fjärran (siluetter mot solen)
    const far = new THREE.MeshStandardMaterial({ color: new THREE.Color(C.land).lerp(horizon, 0.55), roughness: 1, flatShading: true, fog: true });
    for (const [x, z, sz] of [[-260, -520, 90], [-120, -700, 60], [210, -600, 110], [420, -420, 70], [-480, -300, 80]]) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), far); m.scale.set(sz * 1.6, sz * 0.7, sz); m.position.set(x, -24, z); s.add(m);
    }
    // måsar
    const gullMat = new THREE.MeshBasicMaterial({ color: "#2a1a14", fog: true });
    for (let i = 0; i < 6; i++) {
      const gull = new THREE.Group(); const w1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.22), gullMat), w2 = w1.clone();
      w1.position.x = -0.42; w2.position.x = 0.42; gull.add(w1, w2); s.add(gull);
      const ph = Math.random() * 6, rr = 30 + Math.random() * 40, hh = 10 + Math.random() * 8, sp = 0.05 + Math.random() * 0.04;
      this.upd.push((t) => { const a = ph + t * sp; gull.position.set(Math.cos(a) * rr, hh + Math.sin(t + ph) * 1.5, -40 + Math.sin(a) * rr * 0.5); gull.rotation.y = -a; const f = Math.sin(t * 7 + ph) * 0.5; w1.rotation.z = f; w2.rotation.z = -f; });
    }
    // damm i ljuset
    const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(Array.from({ length: 360 }, (_, i) => (i % 3 === 1 ? Math.random() * 4 : (Math.random() - 0.5) * 10)), 3)),
      new THREE.PointsMaterial({ size: 0.03, color: C.sun, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.add(dust); this.upd.push((t) => { dust.rotation.y = t * 0.02; dust.position.y = Math.sin(t * 0.3) * 0.2; });

    // ljus: solen framför karaktären (han tittar mot den) → ansiktet är alltid belyst
    s.add(new THREE.HemisphereLight(C.sky[0], "#4a3020", 0.75));
    const sunL = new THREE.DirectionalLight(C.sun, 1.45); sunL.position.copy(this.sunDir).multiplyScalar(40); sunL.castShadow = true;
    sunL.shadow.mapSize.setScalar(2048); const sc = sunL.shadow.camera; sc.left = sc.bottom = -8; sc.right = sc.top = 8; sc.far = 120; sunL.shadow.bias = -0.0004;
    s.add(sunL);
    const warm = new THREE.PointLight("#ffb070", 0.9, 10, 1.6); warm.position.set(1.5, 2, -3.5); s.add(warm);
    const rim = new THREE.DirectionalLight(C.sky[0], 0.8); rim.position.set(-6, 5, 10); s.add(rim);
  }

  protected place(char: Char) {
    const r = char.root;
    this.H = this.site.character.height;
    char.st.yaw = Math.PI; // tittar ut mot havet/solen
    r.position.x += 0; r.position.z += -1.6; r.updateMatrixWorld(true);
    char.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    const b = worldBox(r); this.F.set((b.min.x + b.max.x) / 2, b.min.y + this.H * 0.62, (b.min.z + b.max.z) / 2);
  }

  private shotAt(t: number, snap: boolean) {
    const H = this.H, F = this.F;
    const shot = t < SHOT_B ? 0 : t < SHOT_C ? 1 : 2;
    const cut = shot !== this.shot; this.shot = shot;
    let pos: THREE.Vector3, look: THREE.Vector3, fov: number;
    const mob = this.camera.aspect < 1 ? 1.45 : 1;
    if (shot === 0) { // etablering från havssidan, långsam push-in
      const k = t / SHOT_B;
      pos = F.clone().add(new THREE.Vector3(1.7 * H, 0.18 * H, -(5 - 1.1 * k) * H * mob));
      look = F.clone().add(new THREE.Vector3(0.2 * H, 0.05 * H, 0)); fov = 38;
    } else if (shot === 1) { // låg vinkel, kranåkning uppåt
      const k = (t - SHOT_B) / (SHOT_C - SHOT_B);
      pos = F.clone().add(new THREE.Vector3(-1.5 * H, (-0.55 + 0.6 * k) * H, -2.6 * H * mob));
      look = F.clone().add(new THREE.Vector3(0, 0.22 * H, 0)); fov = 44;
    } else { // över axeln (3/4) ut mot solen
      const i = Math.min(1, (t - SHOT_C) / 12), sway = Math.sin(t * 0.6) * 0.04 * H;
      pos = F.clone().add(new THREE.Vector3((0.8 - 0.1 * i) * H, (0.42 + sway) * H, (1.55 - 0.15 * i) * H * mob));
      look = F.clone().add(new THREE.Vector3(-0.6 * H, 0.05 * H, -9 * H)); fov = 42;
    }
    if (cut || snap) { this.camPos.copy(pos); this.camLook.copy(look); this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    return { pos, look, fov, cut, shot };
  }

  protected frame(t: number, dt: number, tt: number) {
    for (const u of this.upd) u(t, dt);
    if (!this.char) return;
    const glance = this.shot === 2 && tt < 0 && Math.sin(this.t * 0.45) > 0.35;
    this.char.pointer.lerp(glance ? this.glanceAt : this.pointer, Math.min(1, dt * 2));
    const ft = this.skipTo >= 0 ? this.t - this.skipOff : this.at; // filmklockan
    if (tt < 0) {
      const s = this.shotAt(ft, false);
      this.camPos.lerp(s.pos, 1 - Math.exp(-4 * dt)); this.camLook.lerp(s.look, 1 - Math.exp(-6 * dt));
      this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
      // förtexter / titel via data-attribut
      const R = this.dom.root;
      R.dataset.shot = String(s.shot);
      if (s.cut) { const L = this.site.intro?.lines ?? [`a ${this.site.ticker} production`, this.site.tagline]; this.dom.credits.textContent = s.shot < 2 ? L[s.shot] ?? "" : ""; }
      if (!this.enterShown && this.goAt !== null && ft > ENTER_AT) { this.enterShown = true; this.hooks.onEnterable(); }
      return;
    }
    // ---- warp ----
    const e = Math.min(1, tt / WARP), o = e * (0.22 + 0.78 * e * e);
    if (!this.warpInit) { this.warpInit = true; this.hooks.sfx("warp"); swellAmbience(1, 0.8); this.warpFrom.copy(this.camera.position); this.warpDir.copy(this.camLook).sub(this.camera.position).normalize(); }
    this.camera.position.copy(this.warpFrom).addScaledVector(this.warpDir, 150 * o);
    this.camera.fov = 42 + 30 * o; this.camera.updateProjectionMatrix();
    this.fx.bloom.strength = 0.42 + 3.2 * o;
    this.fx.u.uExpo.value = 1 + 1.9 * o;
    this.fx.u.uWarp.value = o * o * 1.05;
    this.dom.root.style.setProperty("--flash", String(smooth(WARP - 0.55, WARP, tt)));
    if (tt >= WARP) this.done();
  }
  private warpInit = false;
  private warpFrom = new THREE.Vector3();
  private warpDir = new THREE.Vector3();
  private skipTo = -1; private skipOff = 0;

  /** Hoppa direkt till sista tagningen (ENTER syns). */
  skip() { if (this.skipTo >= 0) return; this.skipTo = ENTER_AT + 0.1; this.skipOff = this.t - this.skipTo; }

  dispose() { removeEventListener("pointermove", this.onMove); super.dispose(); }
}
