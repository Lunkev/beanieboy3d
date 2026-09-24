import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Slutpass för intron. mode 0 = film (radiell warp-blur, exponering, varm ton), 1 = VHS (färgblödning, trackingband,
 * radjitter, brus), 2 = CCTV (fisheye, monokrom grön, scanlines, stegad bild). static/glitch funkar i alla lägen.
 */
const IntroShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uMode: { value: 0 },
    uWarp: { value: 0 },
    uExpo: { value: 1 },
    uTint: { value: new THREE.Color(1, 0.93, 0.8) },
    uStatic: { value: 0 },
    uGlitch: { value: 0 },
    uColor: { value: 0 },
    uVig: { value: 0.35 },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uMode, uWarp, uExpo, uStatic, uGlitch, uColor, uVig; uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; float t = uTime;
      // glitch: block-förskjutning
      if (uGlitch > 0.) { float b = floor(uv.y * 18.) + floor(t * 12.); float h = hash(vec2(b, 3.1)); if (h < uGlitch * .6) uv.x += (hash(vec2(b, 7.)) - .5) * .12 * uGlitch; }
      vec3 col;
      if (uMode > 1.5) { // CCTV
        t = floor(t * 12.) / 12.;
        vec2 c = uv - .5; uv = .5 + c * (1. + .22 * dot(c, c));
        if (uv.x < 0. || uv.x > 1. || uv.y < 0. || uv.y > 1.) { gl_FragColor = vec4(0., 0., 0., 1.); return; }
        vec3 raw = texture2D(tDiffuse, uv).rgb;
        float l = dot(raw, vec3(.299, .587, .114)); l = pow(l, .9) * 1.15;
        vec3 mono = vec3(.78, 1., .82) * l;
        col = mix(mono, raw, uColor);
        col *= .88 + .12 * sin(uv.y * uRes.y * 1.6);
        col += (hash(uv * uRes + t * 91.) - .5) * .16 * (1. - uColor * .7);
        float roll = smoothstep(.0, .08, abs(fract(uv.y - t * .05) - .5) - .42); col *= 1. - roll * .12;
      } else if (uMode > .5) { // VHS
        float line = floor(uv.y * 240.);
        uv.x += (hash(vec2(line, floor(t * 30.))) - .5) * .0025 * (1. + uGlitch * 18.);
        float ty = fract(1. - t * .07), tb = smoothstep(.04, 0., abs(uv.y - ty));
        uv.x += tb * .018 * sin(uv.y * 420. + t * 24.);
        float r = texture2D(tDiffuse, uv + vec2(.0045, 0.)).r;
        vec3 g3 = (texture2D(tDiffuse, uv + vec2(-.0015, 0.)).rgb + texture2D(tDiffuse, uv).rgb + texture2D(tDiffuse, uv + vec2(.0015, 0.)).rgb) / 3.;
        float b = texture2D(tDiffuse, uv - vec2(.0035, 0.)).b;
        col = vec3(r, g3.g, b);
        float l = dot(col, vec3(.299, .587, .114)); col = mix(vec3(l), col, 1.28); col = (col - .5) * 1.08 + .52;
        col *= .93 + .07 * sin(uv.y * uRes.y * 3.14);
        col += (hash(uv * uRes + t) - .5) * .09;
        col += tb * (hash(vec2(uv.x * 400., t)) * .35);
      } else { // film
        vec2 c = vec2(.5, .52);
        if (uWarp > 0.) {
          vec3 acc = vec3(0.); float wsum = 0.;
          for (int i = 0; i < 14; i++) { float k = float(i) / 13.; float s = 1. - k * .22 * uWarp; float w = 1. - k * .5; acc += texture2D(tDiffuse, c + (uv - c) * s).rgb * w; wsum += w; }
          col = acc / wsum;
          col = mix(col, col * uTint * 1.4, uWarp * .6);
        } else col = texture2D(tDiffuse, uv).rgb;
        col *= uExpo;
      }
      if (uStatic > 0.) { float n = hash(floor(vUv * uRes / 2.) + floor(uTime * 40.)); col = mix(col, vec3(n) * vec3(.95, .97, 1.), uStatic); }
      col *= 1. - uVig * smoothstep(.3, .95, length(vUv - .5) * 1.4);
      gl_FragColor = vec4(col, 1.);
    }`,
};

export function buildIntroFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, mode: 0 | 1 | 2, bloomStrength: number, pr: number) {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pr);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), bloomStrength, 0.7, 0.9);
  if (bloomStrength > 0) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fin = new ShaderPass(IntroShader);
  fin.uniforms.uMode.value = mode;
  fin.uniforms.uVig.value = mode === 2 ? 0.7 : mode === 1 ? 0.45 : 0.3;
  composer.addPass(fin);
  const u = fin.uniforms as unknown as Record<string, { value: number }> & { uTint: { value: THREE.Color } };
  const resize = () => { composer.setSize(innerWidth, innerHeight); fin.uniforms.uRes.value.set(innerWidth * pr, innerHeight * pr); bloom.resolution.set(innerWidth / 2, innerHeight / 2); };
  resize();
  return { composer, bloom, u, resize };
}
