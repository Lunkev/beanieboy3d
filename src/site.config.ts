import type { SiteConfig } from "./types";
// ════════════════════════════════════════════════════════════════════
//  $BEANIE (testnamn) — format "landing" = scroll-film.
//  Karaktären står i origo; varje beat sätter kamera (yaw/dist/lookY i karaktärshöjder), sida, klipp och bakgrund.
//  idle = animationen i /models/beanie.glb (Meshy-riggad). Övriga klipp = egna GLB:er (bara skelett + animation) som
//  retargetas till huvudskelettet i core/character.ts. Klipp utan namn i en beat = idle.
// ════════════════════════════════════════════════════════════════════
export const site: SiteConfig = {
  format: "landing",
  skin: "nintendo",
  name: "BEANIE",
  ticker: "$BEANIE",
  tagline: "beanie down. zero plans. infinite gum.",
  chain: "solana",
  ca: "85CFzyw4j2439QcabKnNNd4AJfMnJ11EPzQ6TXFupHG7",
  links: { x: "https://x.com/beanieboystonk", buy: "https://www.stonkfun.xyz/token/85CFzyw4j2439QcabKnNNd4AJfMnJ11EPzQ6TXFupHG7" },
  lore: [
    "The beanie stays down, the gum stays in.",
    "He doesn't talk much. He blows bubbles and watches the chart.",
  ],
  howToBuy: [
    { t: "Get Phantom", d: "Download the Phantom wallet and save your seed phrase somewhere safe." },
    { t: "Load up on SOL", d: "Buy SOL on an exchange and send it to your wallet." },
    { t: "Buy $BEANIE on StonkFun", d: "Open the buy link on this site or paste the contract address. Only trust the CA here." },
    { t: "Swap and chill", d: "Swap SOL for $BEANIE. Pull the beanie down. Blow a bubble." },
  ],
  memes: ["/memes/1.webp", "/memes/2.webp", "/memes/3.webp", "/memes/4.webp", "/memes/5.webp", "/memes/6.webp", "/memes/7.webp", "/memes/8.webp"],
  palette: { bg: "#c6ef3f", fog: "#c6ef3f", accent: "#e3342f", accent2: "#c6ef3f", ink: "#111111", panel: "#ffffff", panelInk: "#111111" },
  fonts: { display: "Anton", body: "Rubik" },
  loaderText: "pulling the beanie down…",
  hint: "scroll · drag to spin · click him",
  character: {
    file: "/models/beanie.glb",
    height: 1.2, pos: [0, 0, 0], front: "+z",
    idle: 0,
    clips: [
      { file: "/models/beanie-dance.glb", name: "dance" },
      { file: "/models/beanie-run.glb", name: "run" },
      { file: "/models/beanie-wave.glb", name: "wave" },
    ],
    reactions: ["wave", "dance"],
    quotes: ["…", "don't lift the beanie.", "gm.", "beanie stays on.", "i'm not late. i'm early for tomorrow.", "chart's red. gum's pink. balance.", "*pop*"],
    label: "poke beanie",
    headTrack: false,
  },
  props: [],
  post: { bloom: 0, bloomThreshold: 1, grain: 0, vignette: 0, aberration: 0, pixelate: 0, colorLevels: 0, scanlines: 0 },
  landing: {
    heroWord: "BEANIE",
    marquee: ["$BEANIE", "beanie down", "the beanie stays on", "infinite gum", "no brakes", "zero plans"],
    disclaimer: "$BEANIE is a meme coin with no intrinsic value or expectation of financial return. No team, no roadmap. Just the beanie.",
    bubble: { color: "#ff7ac0", bone: "Head", off: [0, 0.655, 0.21], size: 0.075, every: 6 },
    rain: { colors: ["#ff7ac0", "#ffffff", "#e3342f", "#ffb3dc"], count: 30 },
    anatomy: [
      { bone: "Head", off: [0, 0.93, 0.08], title: "The beanie", body: "Has never come off. Not once. Not even in the shower." },
      { bone: "Head", off: [-0.075, 0.75, 0.2], title: "The eyes", body: "Two of them. The beanie hides one — you only see the other. Both have seen every candle." },
      { bone: "Head", off: [0, 0.66, 0.24], title: "The gum", body: "Always one bubble away from popping." },
      { bone: "LeftFoot", off: [0.13, 0.07, 0.12], title: "The kicks", body: "Size 14 shoes on size 4 feet. Balance is a lifestyle." },
    ],
    routine: [
      { title: "Skip class", body: "Beanie down. Eyes closed. Technically present.", img: "/memes/8.webp" },
      { title: "Check the chart", body: "Red candles. Blows a bubble. Unbothered.", img: "/memes/4.webp" },
      { title: "Hit the park", body: "One kickflip. Zero pads. Full send.", img: "/memes/2.webp" },
      { title: "Rooftop sunset", body: "Thinks about nothing. Perfect day.", img: "/memes/6.webp" },
    ],
    beats: [
      { id: "hero", kind: "hero", kicker: "ON THE BLOCK", title: "$BEANIE", body: "Beanie down. Zero plans. Infinite gum.", clip: "idle", bg: "#c6ef3f", screens: 1.6,
        cam: { yaw: 0, pitch: 4, dist: 2.7, lookY: 0.5, side: 0 } },
      { id: "who", kind: "story", kicker: "WHO IS HE", title: "Eyes on the chart", nav: "about", clip: "idle", bg: "#f1f1ea",
        body: "The beanie stays down, the gum stays in. He doesn't talk much. He blows bubbles and watches.",
        cam: { yaw: -30, pitch: 8, dist: 2.3, lookY: 0.64, side: 1 } },
      { id: "anatomy", kind: "anatomy", kicker: "BUILT DIFFERENT", title: "The starter pack", clip: "idle", bg: "#e4e7ea", screens: 2.6,
        cam: { yaw: 22, pitch: 6, dist: 2.3, lookY: 0.5, side: 0, fov: 28 } },
      { id: "day", kind: "routine", kicker: "DAILY ROUTINE", title: "A day as Beanie", clip: "wave", bg: "#c6ef3f", screens: 2.4,
        cam: { yaw: -8, pitch: 2, dist: 3.1, lookY: 0.42, side: 0 } },
      { id: "vault", kind: "memes", kicker: "THE VAULT", title: "Caught on camera", nav: "memes", clip: "dance", bg: "#17191d", screens: 2.8,
        body: "Every photo ever taken of him. Same face in all of them.",
        cam: { yaw: 12, pitch: 5, dist: 2.6, lookY: 0.48, side: 1 } },
      { id: "dash", kind: "dash", title: "No brakes", body: "late for nothing. still running.", clip: "run", bg: "#e3342f", screens: 2.2,
        cam: { yaw: 0, pitch: 2, dist: 3.6, lookY: 0.45, side: 0 } },
      { id: "buy", kind: "buy", kicker: "HOW TO COP", title: "Get $BEANIE", nav: "buy", clip: "wave", bg: "#c6ef3f", screens: 2,
        cam: { yaw: 20, pitch: 5, dist: 2.4, lookY: 0.5, side: 1 } },
      { id: "end", kind: "outro", title: "$BEANIE", body: "beanie down. see you on the block.", clip: "dance", bg: "#111317", screens: 1.4,
        cam: { yaw: -12, pitch: 8, dist: 3.4, lookY: 0.4, side: 0 } },
    ],
  },
  dock: [],
};
