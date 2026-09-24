import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { PostConfig } from "../types";

/** Slutpass i skärmrymd: pixelering (PS1), färgnivåer + dither, kromatisk aberration, scanlines, vinjett, grain. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.35 },
    uAberr: { value: 0.0015 },
    uPixel: { value: 0 },
    uLevels: { value: 0 },
    uScan: { value: 0 },
    uWarp: { value: 0 },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uGrain, uVignette, uAberr, uPixel, uLevels, uScan, uWarp;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    float bayer4(vec2 p){ int x=int(mod(p.x,4.)), y=int(mod(p.y,4.)); int i=x+y*4;
      float m[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return m[i]/16.-0.5; }
    void main(){
      vec2 uv = vUv;
      if (uPixel > 0.5) { vec2 px = uPixel / uRes; uv = (floor(uv / px) + 0.5) * px; }
      vec2 d = uv - 0.5;
      float ab = uAberr + uWarp * .01;
      float r = texture2D(tDiffuse, uv + d * ab * 2.).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - d * ab * 2.).b;
      vec3 col = vec3(r,g,b);
      if (uWarp > 0.001) { // radiell zoom-blur (warp när en sektion öppnas)
        vec3 acc = col; for (int i = 1; i < 10; i++) { float k = float(i) / 9.; acc += texture2D(tDiffuse, .5 + d * (1. - k * .12 * uWarp)).rgb; }
        col = mix(col, acc / 10., min(1., uWarp * 1.5)) * (1. + uWarp * .35);
      }
      if (uLevels > 0.5) { vec2 cell = floor(vUv * uRes / max(uPixel,1.)); col = floor(col * uLevels + 0.5 + bayer4(cell) * 0.9) / uLevels; }
      if (uScan > 0.) col *= 1. - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 1.5));
      col *= 1. - uVignette * smoothstep(0.35, 0.95, length(d) * 1.35);
      col += (hash(vUv * uRes + fract(uTime) * 100.) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.);
    }`,
};

export function buildPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, cfg: PostConfig, pixelRatio: number) {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pixelRatio);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), cfg.bloom, 0.55, cfg.bloomThreshold ?? 0.82);
  if (cfg.bloom > 0) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const final = new ShaderPass(FinalShader);
  final.uniforms.uGrain.value = cfg.grain;
  final.uniforms.uVignette.value = cfg.vignette;
  final.uniforms.uAberr.value = cfg.aberration;
  final.uniforms.uPixel.value = (cfg.pixelate ?? 0) * pixelRatio;
  final.uniforms.uLevels.value = cfg.colorLevels ?? 0;
  final.uniforms.uScan.value = cfg.scanlines ?? 0;
  composer.addPass(final);

  function resize(w: number, h: number) {
    composer.setSize(w, h);
    final.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
    bloom.resolution.set(w / 2, h / 2);
  }
  resize(innerWidth, innerHeight);
  // warp-puls: skalet skickar "memeroom:warp" när en sektion öppnas
  let warpT = -1;
  const onWarp = () => { warpT = 0; };
  addEventListener("memeroom:warp", onWarp);
  let last = 0;
  const tick = (t: number) => {
    final.uniforms.uTime.value = t;
    const dt = Math.min(0.05, Math.max(0, t - last)); last = t;
    if (warpT >= 0) { warpT += dt; const k = warpT / 0.75; final.uniforms.uWarp.value = k < 1 ? Math.sin(k * Math.PI) * (1 - k * 0.3) : 0; if (k >= 1) warpT = -1; }
  };
  return { composer, resize, tick, dispose: () => removeEventListener("memeroom:warp", onWarp) };
}
