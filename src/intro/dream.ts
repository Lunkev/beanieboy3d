import * as THREE from "three";
import { IntroBase, type Char, type IntroDom, type IntroHooks } from "./base";
import type { SiteConfig } from "../types";
import { glowTexture } from "../core/textures";
import { worldBox } from "../core/util";
import { swellAmbience } from "../ui/sfx";

const S = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const BUBBLE_IN = 1.0, BUBBLE_OUT = 4.9, LIDS = 5.3, END = 6.2;

/**
 * Dröm-intro: karaktären sover (flyter på ett nattligt hav eller ligger på ett moln), z z z stiger.
 * ENTER → kameran glider närmare, en drömbubbla visar sajtens memes, bubblan spricker, ögonlocken stängs → sajten.
 */
export class DreamIntro extends IntroBase {
  private setting: "sea" | "clouds";
  private upd: ((t: number, dt: number) => void)[] = [];
  private head = new THREE.Vector3();
  private center = new THREE.Vector3();
  private H = 1;
  private baseY = 0;
  private memeIdx = 0; private memeT = 0;
  private popped = false;

  constructor(host: HTMLElement, site: SiteConfig, dom: IntroDom, hooks: IntroHooks) {
    super(host, site, dom, hooks, 0, 0.25);
    this.setting = site.intro?.dream?.setting ?? "sea";
  }

  enterLabel() { return this.site.intro?.enter ?? "ENTER"; }

  protected build() {
    const s = this.scene, night = this.setting === "sea";
    const top = new THREE.Color(night ? "#050818" : "#8fb4ff"), hor = new THREE.Color(night ? "#2a1f55" : "#ffd6e8");
    s.fog = new THREE.Fog(hor, 30, 160);
    this.renderer.toneMappingExposure = night ? 0.95 : 0.95;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { a: { value: top }, b: { value: hor } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: "uniform vec3 a, b; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(b, a, smoothstep(-.05, .6, vP.y)), 1.); }",
    }));
    s.add(sky);
    // stjärnor (natt) / glitter (moln)
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.08; pos.set([Math.cos(u) * Math.cos(v) * 250, Math.sin(v) * 250, Math.sin(u) * Math.cos(v) * 250], i * 3); }
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)),
      new THREE.PointsMaterial({ size: night ? 1.4 : 1.1, color: night ? "#ffffff" : "#fff6fb", transparent: true, opacity: night ? 0.9 : 0.5, fog: false, sizeAttenuation: true }));
    s.add(stars); this.upd.push((t) => { stars.rotation.y = t * 0.004; (stars.material as THREE.PointsMaterial).opacity = (night ? 0.75 : 0.4) + Math.sin(t * 1.3) * 0.15; });
    // måne / sol
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(night ? "#dfe6ff" : "#fff2d6"), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    moon.position.set(-60, 70, -160); moon.scale.setScalar(night ? 60 : 110); s.add(moon);

    if (night) {
      // lugnt nattligt hav med månglitter och ringar runt karaktären
      const mat = new THREE.ShaderMaterial({
        fog: false,
        uniforms: { uT: { value: 0 }, deep: { value: new THREE.Color("#060c26") }, hi: { value: new THREE.Color("#1b3478") }, hor: { value: hor }, moon: { value: new THREE.Vector3(-60, 70, -160).normalize() }, cam: { value: new THREE.Vector3() } },
        vertexShader: `uniform float uT; varying vec3 vW; void main(){ vec3 p = position; p.z += sin(p.x*.25+uT*.6)*.06 + sin(p.y*.3-uT*.5)*.05; vec4 w = modelMatrix*vec4(p,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `uniform float uT; uniform vec3 deep, hi, hor, moon, cam; varying vec3 vW;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          void main(){
            float r = length(vW.xz); float ring = smoothstep(0., .06, abs(fract(r * .55 - uT * .18) - .5) - .44) * (1. - smoothstep(1.5, 9., r));
            vec3 c = mix(deep, hi, .25 + .2 * sin(vW.x * .4 + uT * .3) * sin(vW.z * .35 - uT * .2));
            vec3 v = normalize(cam - vW); vec3 rf = reflect(-v, vec3(0., 1., 0.)); float g = pow(max(dot(rf, moon), 0.), 90.);
            float sp = step(.82, h(floor(vW.xz * 30.) + floor(uT * 5.)));
            c += vec3(.8, .85, 1.) * g * (.3 + sp * .9) + ring * .07 * vec3(.7, .8, 1.);
            c = mix(c, hor, smoothstep(20., 150., length(cam - vW)));
            gl_FragColor = vec4(c, 1.);
          }`,
      });
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 120, 120), mat); sea.rotation.x = -Math.PI / 2; s.add(sea);
      this.upd.push((t) => { mat.uniforms.uT.value = t; mat.uniforms.cam.value.copy(this.camera.position); });
    } else {
      // molnbädd + moln runt om
      const cloud = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true, emissive: "#ffe6f2", emissiveIntensity: 0.25 });
      const puff = new THREE.IcosahedronGeometry(1, 1);
      const bed = new THREE.Group();
      for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(puff, cloud); const a = (i / 16) * Math.PI * 2, r = 0.7 + Math.random() * 0.7; m.position.set(Math.cos(a) * r, -0.35 + Math.random() * 0.15, Math.sin(a) * r * 1.4 - 0.4); m.scale.setScalar(0.55 + Math.random() * 0.35); m.receiveShadow = true; bed.add(m); }
      bed.scale.setScalar(this.site.character.height); s.add(bed);
      for (let i = 0; i < 30; i++) {
        const g = new THREE.Group(), a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 60;
        for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(puff, cloud); m.position.set(k * 1.2 - 2.4, Math.sin(k) * 0.5, Math.random() - 0.5); m.scale.setScalar(0.8 + Math.random() * 0.9); g.add(m); }
        g.position.set(Math.cos(a) * d, -4 - Math.random() * 10, Math.sin(a) * d); g.scale.setScalar(1 + Math.random() * 2); s.add(g);
      }
    }
    // ljus: måne/sol ovanifrån + varmt fyllnadsljus så karaktären alltid syns
    s.add(new THREE.HemisphereLight(night ? "#9fb2ff" : "#ffffff", night ? "#10183a" : "#ffd6e8", night ? 0.7 : 0.9));
    const key = new THREE.DirectionalLight(night ? "#d8e0ff" : "#fff4e6", night ? 0.95 : 1.2); key.position.set(-4, 8, 6); key.castShadow = true; s.add(key);
    const warm = new THREE.PointLight("#ffd2a8", night ? 0.7 : 0.35, 8, 1.5); warm.position.set(1.5, 2.2, 1.5); s.add(warm);
  }

  protected place(char: Char) {
    this.H = this.site.character.height;
    const r = char.root;
    r.rotation.x = -Math.PI / 2; // ligger på rygg, ansiktet uppåt, huvudet mot -Z
    r.updateMatrixWorld(true);
    const b = worldBox(r);
    r.position.y -= b.min.y - (this.setting === "sea" ? -this.H * 0.12 : this.H * 0.05); // lite nedsänkt i vattnet
    r.position.z -= (b.min.z + b.max.z) / 2 - this.H * 0.1;
    r.updateMatrixWorld(true);
    this.baseY = r.position.y;
    const bb = worldBox(r); bb.getCenter(this.center);
    this.head.set(this.center.x, bb.max.y, bb.min.z + this.H * 0.18);
    // blobskuggan hör inte hemma här
    this.scene.children.forEach((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry.type === "PlaneGeometry" && (m.material as THREE.MeshBasicMaterial).isMeshBasicMaterial) m.visible = false; });
    this.camera.position.set(this.H * 1.6, this.H * 2.4, this.H * 1.7);
    this.camera.lookAt(this.center);
    this.hooks.onEnterable();
    this.dom.bubbleImg.src = this.site.memes[0] ?? "";
  }

  protected frame(t: number, dt: number, tt: number) {
    for (const u of this.upd) u(t, dt);
    if (!this.char) return;
    const r = this.char.root, H = this.H;
    // gungar på vågorna / andas på molnet
    r.position.y = this.baseY + Math.sin(t * 0.9) * H * (this.setting === "sea" ? 0.03 : 0.012);
    r.rotation.z = Math.sin(t * 0.6) * 0.05;
    this.char.pointer.set(0, 0);
    // kamera: långsam drift runt den sovande, glider närmare efter ENTER
    const k = tt < 0 ? 0 : S(0, 3.2, tt);
    const a = 0.75 + Math.sin(t * 0.08) * 0.25;
    const dist = H * (2.6 - 1.1 * k), hgt = H * (2.4 - 0.9 * k);
    this.camera.position.set(this.center.x + Math.sin(a) * dist, hgt, this.center.z + Math.cos(a) * dist);
    this.camera.lookAt(this.center.x, this.center.y + H * 0.1, this.center.z - H * 0.15 * k);
    this.camera.updateMatrixWorld();
    const hp = this.project(this.head);
    const D = this.dom;
    D.zzz.style.transform = `translate(${hp.x + 10}px, ${hp.y - 30}px)`;
    D.zzz.style.opacity = tt < 0 ? "1" : String(1 - S(0, 0.8, tt));
    if (tt < 0) return;

    // drömbubbla med memes
    const bin = S(BUBBLE_IN, BUBBLE_IN + 0.6, tt), bout = S(BUBBLE_OUT, BUBBLE_OUT + 0.35, tt);
    const bw = D.bubble.offsetWidth || 400, bh = D.bubble.offsetHeight || 320;
    const bx = Math.min(innerWidth - bw - 20, hp.x + 60), by = Math.max(20, hp.y - bh - 110);
    const pop = 1 + bout * 0.25, sc = (0.2 + 0.8 * bin + Math.sin(Math.min(1, bin) * Math.PI) * 0.08) * pop;
    D.bubble.style.transform = `translate(${bx}px, ${by}px) scale(${sc})`;
    D.bubble.style.opacity = String(bin * (1 - bout));
    // tankeprickar från huvudet mot bubblan
    const dots = D.dots.children;
    for (let i = 0; i < dots.length; i++) {
      const f = (i + 1) / (dots.length + 1), d = dots[i] as HTMLElement, sz = 8 + i * 8;
      const x = hp.x + (bx + 20 - hp.x) * f, y = hp.y - 20 + (by + bh * 0.9 - hp.y) * f;
      d.style.width = d.style.height = `${sz}px`; d.style.transform = `translate(${x - sz / 2}px, ${y - sz / 2}px)`;
      d.style.opacity = String(S(BUBBLE_IN - 0.4 + i * 0.2, BUBBLE_IN + i * 0.2, tt) * (1 - bout));
    }
    D.dots.style.opacity = "1";
    this.memeT += dt;
    if (bin > 0.5 && this.memeT > 0.85 && this.site.memes.length) { this.memeT = 0; this.memeIdx = (this.memeIdx + 1) % this.site.memes.length; D.bubbleImg.src = this.site.memes[this.memeIdx]; }
    if (!this.popped && tt > BUBBLE_OUT) { this.popped = true; this.hooks.sfx("pop"); swellAmbience(0.6, 0.6); }
    // ögonlocken stängs → sajten
    D.root.style.setProperty("--lid", String(S(LIDS, END - 0.15, tt)));
    if (tt >= END) this.done();
  }
}
