import * as THREE from "three";
import { IntroBase, type Char, type IntroDom, type IntroHooks } from "./base";
import type { SiteConfig } from "../types";
import { worldBox } from "../core/util";
import { swellAmbience } from "../ui/sfx";

const S = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const pad = (n: number, l = 2) => String(Math.floor(n)).padStart(l, "0");

/**
 * VHS: blå skärm → PAUSE (fryst bild) → ▶ PLAY: hemmavideo där karaktären vinkar och dansar, kameran zoomar, sedan brus → sajten.
 * CCTV: övervakningskamera med växlande vinklar, REC och rörelseruta → ACCESS FEED: digital zoom, färgen kommer tillbaka → sajten.
 */
export class TapeIntro extends IntroBase {
  private cctv: boolean;
  private H = 1;
  private center = new THREE.Vector3();
  private box = new THREE.Box3();
  private cam = 0; private camT = 0;
  private flags = new Set<string>();
  private clockStart = new Date();

  constructor(host: HTMLElement, site: SiteConfig, dom: IntroDom, hooks: IntroHooks) {
    const cctv = site.intro?.kind === "cctv";
    super(host, site, dom, hooks, cctv ? 2 : 1, cctv ? 0 : 0.3);
    this.cctv = cctv;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
  }

  enterLabel() { return this.site.intro?.enter ?? (this.cctv ? "ACCESS FEED" : "▶ PLAY"); }

  protected build() {
    const s = this.scene, H = this.site.character.height, cctv = this.site.intro?.kind === "cctv";
    this.H = H;
    s.background = new THREE.Color(cctv ? "#1a1c1e" : "#2a1d14");
    // rumshörn: golv + två väggar
    const tex = (draw: (x: CanvasRenderingContext2D) => void, rep: number) => {
      const c = document.createElement("canvas"); c.width = c.height = 256; draw(c.getContext("2d")!);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); return t;
    };
    const floorTex = cctv
      ? tex((x) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? "#a7a59c" : "#c9c6bb"; x.fillRect(i * 64, j * 64, 64, 64); } }, 3)
      : tex((x) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#8a5a3b" : "#7a4d32"; x.fillRect(0, i * 32, 256, 32); x.fillStyle = "#0002"; x.fillRect((i * 97) % 256, i * 32, 2, 32); } }, 2);
    const wallTex = cctv
      ? tex((x) => { x.fillStyle = "#bdb9ad"; x.fillRect(0, 0, 256, 256); x.fillStyle = "#a9a598"; x.fillRect(0, 200, 256, 56); }, 1)
      : tex((x) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#e6cfa3" : "#dcc08f"; x.fillRect(i * 32, 0, 32, 256); } x.fillStyle = "#b58a5a"; x.fillRect(0, 226, 256, 30); }, 2);
    const W = H * 7, D = H * 6, WH = H * 3.2;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.8 })); floor.rotation.x = -Math.PI / 2; floor.position.z = -D / 2 + H * 2.2; floor.receiveShadow = true; s.add(floor);
    const wm = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W, WH), wm); back.position.set(0, WH / 2, -H * 1.6); back.receiveShadow = true; s.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(D, WH), wm); left.rotation.y = Math.PI / 2; left.position.set(-H * 2.3, WH / 2, -D / 2 + H * 1.4); s.add(left);
    const m = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    if (cctv) { // hyllor med kartonger (butik/lager)
      for (let i = 0; i < 3; i++) {
        const sh = new THREE.Group(), x = -H * 1.5 + i * H * 1.6;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(H * 1.3, H * 2.2, H * 0.5), m("#7c8288")); frame.position.y = H * 1.1; sh.add(frame);
        for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(H * 0.36, H * 0.3, H * 0.32), m(["#c9a36b", "#d8b77c", "#b88f5a"][k % 3])); b.position.set(-H * 0.4 + (k % 3) * H * 0.4, H * 0.4 + Math.floor(k / 3) * H * 0.75, H * 0.12); sh.add(b); }
        sh.position.set(x, 0, -H * 1.3); sh.traverse((o) => { o.castShadow = o.receiveShadow = true; }); s.add(sh);
      }
    } else { // soffa + lampa + tavla (vardagsrum)
      const sofa = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(H * 2.2, H * 0.45, H * 0.8), m("#7a3b52")); base.position.y = H * 0.3; sofa.add(base);
      const backr = new THREE.Mesh(new THREE.BoxGeometry(H * 2.2, H * 0.6, H * 0.25), m("#6b3247")); backr.position.set(0, H * 0.75, -H * 0.3); sofa.add(backr);
      sofa.position.set(-H * 0.2, 0, -H * 1.1); sofa.traverse((o) => { o.castShadow = o.receiveShadow = true; }); s.add(sofa);
      const lamp = new THREE.Mesh(new THREE.ConeGeometry(H * 0.25, H * 0.35, 16, 1, true), new THREE.MeshStandardMaterial({ color: "#ffe2b0", emissive: "#ffcf80", emissiveIntensity: 0.8, side: THREE.DoubleSide }));
      lamp.position.set(H * 1.7, H * 1.5, -H * 1.1); s.add(lamp);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, H * 1.4), m("#333")); pole.position.set(H * 1.7, H * 0.7, -H * 1.1); s.add(pole);
      const pl = new THREE.PointLight("#ffcf8a", 3, H * 6, 1.5); pl.position.set(H * 1.7, H * 1.4, -H * 0.9); s.add(pl);
      if (this.site.memes[0]) { new THREE.TextureLoader().load(this.site.memes[0], (tx) => { tx.colorSpace = THREE.SRGBColorSpace; const pic = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.8, H * 0.8), new THREE.MeshStandardMaterial({ map: tx })); pic.position.set(-H * 0.2, H * 1.62, -H * 1.58); s.add(pic); }); }
    }
    s.add(new THREE.HemisphereLight("#ffffff", cctv ? "#666" : "#5a3a2a", cctv ? 1.4 : 1.0));
    const key = new THREE.DirectionalLight(cctv ? "#ffffff" : "#fff1dd", cctv ? 1.4 : 1.6); key.position.set(H * 2, H * 5, H * 4); key.castShadow = true; s.add(key);
  }

  protected place(char: Char) {
    char.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    char.root.position.z += this.H * 0.2;
    char.root.updateMatrixWorld(true);
    worldBox(char.root).getCenter(this.center);
    this.setCam(0, true);
    if (!this.cctv) this.char.mixer.timeScale = 0; // PAUSE = fryst bild
    this.hooks.onEnterable();
  }

  /** CCTV-kameror (hörn högt upp) eller VHS-handkamera. */
  private setCam(i: number, snap = false) {
    const H = this.H, c = this.center;
    if (!this.cctv) { this.camera.fov = 45; this.camera.position.set(H * 0.35, H * 0.95, H * 2.8); this.camera.lookAt(c.x, H * 0.6, c.z); this.camera.updateProjectionMatrix(); return; }
    const P = [[H * 2.4, H * 2.6, H * 2.8], [-H * 2.1, H * 2.7, H * 2.4], [H * 2.9, H * 2.3, -H * 0.2]][i % 3];
    this.camera.position.set(P[0], P[1], P[2]); this.camera.fov = 58; this.camera.updateProjectionMatrix();
    this.camera.lookAt(c.x, H * 0.45, c.z);
    if (!snap) { this.fx.u.uGlitch.value = 0.6; this.hooks.sfx("beep"); }
  }

  protected frame(t: number, dt: number, tt: number) {
    const H = this.H, D = this.dom, u = this.fx.u;
    u.uGlitch.value = Math.max(0, u.uGlitch.value - dt * 3);
    const clock = new Date(this.clockStart.getTime() + t * 1000);
    if (this.cctv) this.frameCctv(t, dt, tt, clock); else this.frameVhs(t, dt, tt, clock);
    // rörelseruta / etiketter följer karaktären
    if (this.char) {
      this.box.setFromObject(this.char.root);
      const a = this.project(new THREE.Vector3(this.box.min.x, this.box.max.y, this.center.z)), b = this.project(new THREE.Vector3(this.box.max.x, this.box.min.y, this.center.z));
      const x = Math.min(a.x, b.x) - 14, y = Math.min(a.y, b.y) - 14, w = Math.abs(b.x - a.x) + 28, h = Math.abs(b.y - a.y) + 28;
      D.box.style.transform = `translate(${x}px, ${y}px)`; D.box.style.width = `${w}px`; D.box.style.height = `${h}px`;
    }
    void H;
  }

  private frameVhs(t: number, dt: number, tt: number, now: Date) {
    const D = this.dom, u = this.fx.u, H = this.H, c = this.center;
    const label = this.site.intro?.lines?.[0] ?? `${this.site.name.toUpperCase()} HOME VIDEO`;
    const date = now.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).toUpperCase().replace(",", "");
    const time = `${now.getHours() % 12 || 12}:${pad(now.getMinutes())} ${now.getHours() < 12 ? "AM" : "PM"}`;
    D.box.style.display = "none";
    if (tt < 0) { // PAUSE: fryst, darrande bild
      D.credits.textContent = Math.floor(t * 1.4) % 2 ? "❚❚ PAUSE" : "❚❚"; D.sub.textContent = label;
      D.osd.textContent = `SP\n0:00:00`;
      u.uGlitch.value = Math.max(u.uGlitch.value, 0.08 + (Math.sin(t * 9) > 0.8 ? 0.2 : 0));
      this.camera.position.y = H * 0.95 + Math.sin(t * 30) * 0.004;
      return;
    }
    if (!this.flags.has("play")) { this.flags.add("play"); this.hooks.sfx("clunk"); this.char.mixer.timeScale = 1; }
    const counter = Math.max(0, tt - 0.4);
    D.credits.textContent = tt < 5.2 ? "▶ PLAY" : "⏏ EJECT"; D.sub.textContent = `${time}\n${date}`;
    D.osd.textContent = `SP\n0:${pad(counter / 60)}:${pad(counter % 60)}`;
    u.uStatic.value = tt < 0.45 ? 1 - S(0.1, 0.45, tt) : S(5.3, 5.9, tt);
    if (tt < 0.45 && !this.flags.has("s1")) { this.flags.add("s1"); this.hooks.sfx("static"); }
    // handhållen kamera som zoomar in
    const z = S(0.6, 4.5, tt);
    this.camera.fov = 45 - 14 * z; this.camera.updateProjectionMatrix();
    this.camera.position.set(H * (0.35 + Math.sin(tt * 1.3) * 0.04), H * (0.95 + Math.sin(tt * 2.1) * 0.03), H * (2.8 - 0.3 * z));
    this.camera.lookAt(c.x + Math.sin(tt * 0.9) * H * 0.04, H * (0.6 + 0.05 * z), c.z);
    if (tt > 0.8 && !this.flags.has("wave")) { this.flags.add("wave"); this.char.react("wave"); }
    if (tt > 3.1 && !this.flags.has("dance")) { this.flags.add("dance"); this.char.react("dance"); }
    if (tt > 5.3 && !this.flags.has("s2")) { this.flags.add("s2"); this.hooks.sfx("static"); swellAmbience(0.6, 0.4); }
    D.root.style.setProperty("--flash", String(S(5.7, 6.2, tt)));
    if (tt >= 6.2) this.done();
  }

  private frameCctv(t: number, dt: number, tt: number, now: Date) {
    const D = this.dom, u = this.fx.u, H = this.H;
    const loc = this.site.intro?.lines?.[0] ?? "AISLE 7";
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}  ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    D.osd.textContent = stamp;
    const rec = Math.floor(t * 1.2) % 2 ? "● REC" : "  REC";
    D.box.style.display = "";
    const lab = D.box.firstElementChild as HTMLElement;
    if (tt < 0) {
      this.camT += dt;
      if (this.camT > 2.6) { this.camT = 0; this.cam++; this.setCam(this.cam); }
      D.credits.textContent = `CAM 0${(this.cam % 3) + 1}   ${rec}\n${loc}`;
      lab.textContent = Math.floor(t * 2) % 2 ? "MOTION DETECTED" : "";
      return;
    }
    if (!this.flags.has("go")) { this.flags.add("go"); this.cam = 0; this.setCam(0); this.hooks.sfx("beep"); }
    // digital zoom i steg mot karaktären
    const step = Math.min(6, Math.floor(tt / 0.35)), fov = 58 - step * 6;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); if (step > 0) this.hooks.sfx("beep"); }
    this.camera.lookAt(this.center.x, this.center.y + H * 0.2 * Math.min(1, tt / 2), this.center.z);
    D.credits.textContent = `CAM 01   ${rec}\nZOOM x${(1 + step * 0.6).toFixed(1)}`;
    lab.textContent = tt > 2.2 ? `SUBJECT IDENTIFIED: ${this.site.ticker}` : "TRACKING…";
    if (tt > 2.2 && !this.flags.has("look")) { this.flags.add("look"); this.char.react("wave"); }
    this.char.pointer.set(0, 0.3);
    u.uColor.value = S(2.6, 3.3, tt);
    u.uGlitch.value = Math.max(u.uGlitch.value, S(3.6, 4.0, tt) * 0.8);
    u.uStatic.value = S(3.8, 4.2, tt);
    if (tt > 3.7 && !this.flags.has("s")) { this.flags.add("s"); this.hooks.sfx("static"); swellAmbience(0.6, 0.3); }
    D.root.style.setProperty("--flash", String(S(4.0, 4.4, tt)));
    if (tt >= 4.4) this.done();
  }
}
