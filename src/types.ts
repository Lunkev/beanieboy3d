// Alla typer för site.config.ts. En ny sajt = ny config + nya assets. Motorn rörs inte.

export type Vec3 = [number, number, number];
export type Section = "about" | "memes" | "buy" | "chart";
/** Vad som händer vid klick: öppna en sektion, eller öppna en länk (t.ex. "link:x"). */
export type OpenTarget = Section | `link:${"x" | "dex" | "buy" | "telegram"}`;

export interface Palette {
  bg: string;       // sidans/scenens bakgrund
  fog: string;
  accent: string;   // huvudaccent (knappar, neon)
  accent2: string;  // andra accent
  ink: string;      // text på paneler
  panel: string;    // panelbakgrund
  panelInk: string; // text i paneler
}

export type FloorKind = "checker" | "wood" | "carpet" | "tile" | "concrete" | "tatami";
export type WallKind = "stripes" | "panel" | "brick" | "plain" | "tile" | "damask" | "wood";
export type ParticleKind = "dust" | "petals" | "snow" | "money" | "embers" | "bubbles" | "stars";

export interface RoomConfig {
  width: number;   // x
  depth: number;   // z
  height: number;  // y (väggarna)
  floor: { kind: FloorKind; a: string; b: string; repeat?: number };
  walls: { kind: WallKind; a: string; b: string; trim?: string };
  /** "cutaway" = golv + bakvägg + vänstervägg (klassisk diorama). "corner-right" speglar. "floating" = bara en platta. */
  shape: "cutaway" | "corner-right" | "floating";
  backdrop: { kind: "stars" | "gradient" | "void"; top: string; bottom: string };
  lights: {
    ambient: number;
    key: string; keyIntensity: number; keyPos: Vec3;
    rim: string; rimIntensity: number;
    practical?: { color: string; intensity: number; pos: Vec3 }[]; // lampor i rummet
  };
  particles?: { kind: ParticleKind; count: number; color: string; area?: number };
}

export type Front = "+x" | "-x" | "+z" | "-z";

export interface CharacterConfig {
  /** GLB från Higgsfield/Meshy. Saknas filen visas en procedurell platshållare (bara i dev). */
  file: string;
  height: number;
  pos: Vec3;
  /** Utelämna = vänd mot startkameran automatiskt. */
  rotY?: number;
  /** Modellens framsida. Meshy = "+z" (standard). */
  front?: Front;
  /** Klipp-namn (eller index) för idle-loopen. */
  idle?: string | number;
  /** Extra GLB:er med samma Meshy-rigg — deras klipp slås ihop med karaktärens. name = vad vi kallar klippet. */
  clips?: { file: string; name: string; inPlace?: boolean; retarget?: boolean }[];
  /** Retargeta klipp från andra riggjobb till huvudmodellens skelett (fixar vridna händer/fötter när bone roll skiljer). Default true. */
  retarget?: boolean;
  /** Klipp som spelas när man klickar på karaktären (roteras). */
  reactions?: string[];
  /** Pratbubblor: slumpas vid klick och ibland av sig själv. */
  quotes: string[];
  label: string;
  /** Vrid huvudbenet mot muspekaren (kräver humanoid rigg). */
  headTrack?: boolean;
  /** Ljus ovanifrån som alltid håller karaktären tydligt belyst. */
  spotlight?: string;
}

export interface PropConfig {
  id: string;
  file: string;
  height: number;
  pos: Vec3;
  /** Riktningen propen tittar åt, i radianer runt Y (0 = mot +Z, dvs. framåt mot betraktaren). */
  rotY?: number;
  /** Vilken lokal axel som är modellens framsida. Tripo-GLB = "+x" (standard), Meshy = "+z". */
  front?: Front;
  /** Ställ ovanpå en annan prop (pos.x/z är då världskoordinater, y ignoreras). */
  onTop?: string;
  open?: OpenTarget;
  label?: string;
  /** Mjuk glöd (punktljus + halo) i denna färg. */
  glow?: string;
  /** Liten svävning/rotation för "magiska" objekt. */
  float?: boolean;
}

export type ScreenKind = "memes" | "ticker" | "chart" | "image" | "ca";
export interface ScreenConfig {
  kind: ScreenKind;
  /** Fri placering i världen (används om attach saknas). */
  pos?: Vec3;
  rotY?: number;
  w?: number;
  h?: number;
  /**
   * Klistra skärmen på en props framsida (lokal +Z, dvs. den sida som var mot kameran i källbilden).
   * rect = [u0, v0, u1, v1] som andel av propens bredd/höjd (0,0 = nere till vänster). Följer med propen i ?edit.
   */
  attach?: { prop: string; rect: [number, number, number, number]; z?: number };
  img?: string;
  open?: OpenTarget;
  label?: string;
  /** CRT-känsla: scanlines + lätt böjning i kanten. */
  crt?: boolean;
}

export type DecorConfig =
  | { type: "frame"; wall: "back" | "left" | "right"; u: number; v: number; w: number; h: number; img: string; open?: OpenTarget; label?: string; frame?: string }
  | { type: "neon"; wall: "back" | "left" | "right"; u: number; v: number; text: string; size: number; color: string; open?: OpenTarget; label?: string; font?: string }
  | { type: "window"; wall: "back" | "left" | "right"; u: number; v: number; w: number; h: number; sky: "night" | "sunset" | "day" | "space"; shaft?: boolean }
  | { type: "rug"; pos: Vec3; w: number; d: number; color: string; color2: string; round?: boolean }
  | { type: "shelf"; wall: "back" | "left" | "right"; u: number; v: number; w: number; color: string }
  | { type: "lamp"; pos: Vec3; color: string; intensity: number };

export interface PostConfig {
  bloom: number;        // 0–1.5
  bloomThreshold?: number;
  grain: number;        // 0–0.2
  vignette: number;     // 0–1
  aberration: number;   // 0–0.004
  /** PS1-känsla: pixelstorlek i skärmpixlar (0 = av, 2–4 = retro). */
  pixelate?: number;
  /** Färgnivåer per kanal (0 = av, 16–32 = retro-dither). */
  colorLevels?: number;
  scanlines?: number;   // 0–0.3
}

/** Sajtformat — varje format är en egen scen/upplevelse, allt annat (innehåll, karaktär, UI) delas. */
export type Format = "room" | "os" | "landing" | "world" | "toy";
/** UI-skal för knappar/paneler/fönster. */
export type Skin = "brutal" | "win95" | "xp" | "terminal" | "glass" | "paper" | "nintendo";

/** Format "room": utforskbart diorama-rum. */
export interface RoomFormat extends RoomConfig {
  camera: { pos: Vec3; target: Vec3; fov: number; orbit: { azimuth: number; polarMin: number; polarMax: number; zoomIn: number; zoomOut: number } };
  screens: ScreenConfig[];
  decor: DecorConfig[];
}

/** Format "os": fejk-operativsystem. Skrivbord med fönster, 3D-visare, terminal och en desktop-pet som går på aktivitetsfältet. */
export interface OsFormat {
  theme: "xp" | "win95" | "mac";
  /** Skrivbordsbakgrund (bild i public/). */
  wallpaper: string;
  /** Rader som skrivs ut på bootskärmen medan allt laddar. */
  bootLines: string[];
  /** Namnet på "operativsystemet", t.ex. "SMOL OS". */
  osName: string;
  /** Skrivbordsikoner. open = sektion/länk, eller en av OS-apparna. */
  icons: { label: string; icon: string; open: OpenTarget | "viewer" | "terminal" | "trash" }[];
  /** Karaktären går fram och tillbaka längs aktivitetsfältet (kräver gärna ett gång-klipp). */
  pet?: { walkClip?: string; height: number };
  /** Terminalen: prompt + egna kommandon (kommando → svarstext). */
  terminal: { prompt: string; motd: string[]; commands?: Record<string, string> };
  /** 3D-visarens fönster. */
  viewer: { title: string; bg: [string, string] };
}

/** Format "landing": scroll-sida med stor 3D-hero, marquee, lore, fejk-X-flöde från karaktären, how to buy, memes. */
/** Kamerans läge i en beat. Karaktären står i origo; allt räknas i karaktärshöjder. */
export interface FilmCam {
  /** Grader runt karaktären: 0 = framifrån, 90 = profil (från karaktärens vänster), 180 = bakifrån. */
  yaw: number;
  /** Grader uppåt/nedåt. */
  pitch?: number;
  /** Avstånd i karaktärshöjder (≈1.2 närbild, 2.6 helfigur, 4 vid). */
  dist: number;
  /** Var kameran tittar, 0 = fötter, 1 = hjässa. */
  lookY: number;
  /** Var karaktären hamnar på skärmen: -1 vänster, 0 mitten, 1 höger (desktop). */
  side: -1 | 0 | 1;
  fov?: number;
}

/**
 * En "beat" = en sektion i scroll-filmen. Sektionen står still (sticky) i `screens` skärmhöjder medan man scrollar;
 * under tiden animeras dess innehåll med den lokala scrollen (0→1), och kameran åker mjukt vidare till nästa beat.
 * hero    = stor titel + CTA          story   = lore-text bredvid karaktären
 * anatomy = pilar som pekar på kroppsdelar (följer benen live)
 * routine = 4 kort "en dag som X" runt karaktären
 * memes   = memebilder som flyger in och läggs i en hög
 * dash    = set piece: karaktären springer tvärs över skärmen
 * buy     = how to buy + CA + köpknapp    outro = jättetext + länkar
 */
export type BeatKind = "hero" | "story" | "anatomy" | "routine" | "memes" | "dash" | "buy" | "outro";
export interface FilmBeat {
  id: string;
  kind: BeatKind;
  /** Liten etikett ovanför rubriken. */
  kicker?: string;
  title: string;
  body?: string;
  /** Klippet karaktären spelar i beaten (namn på action i GLB:n). */
  clip?: string;
  cam: FilmCam;
  /** Bakgrundsfärg i beaten (tonas mellan beats). */
  bg?: string;
  /** Sektionens höjd i skärmhöjder (default 2). */
  screens?: number;
  /** Namn i kapitelmenyn till höger. */
  nav?: string;
}

/**
 * Format "landing" (scroll-film): EN fast 3D-canvas med karaktären över hela sidan. Varje sektion (beat) står still medan man
 * scrollar, kameran åker mellan beats (närbild, profil, bakifrån), karaktären byter klipp per beat och flyttar sig åt sidan så
 * texten får plats. Inspirerat av dickbuttstonk (kamerabeats), homos.family (regn av 3D-objekt, reveal) och bredman (set pieces).
 */
export interface LandingFormat {
  beats: FilmBeat[];
  /** Pilar i anatomy-beaten. off = punktens läge i vila (karaktärshöjder: fötter = 0, +X = karaktärens vänster, +Z = framåt); bone = ben vars rörelse punkten följer. */
  anatomy?: { bone: string; off?: Vec3; title: string; body: string }[];
  /** Korten i routine-beaten. */
  routine?: { title: string; body: string; img: string }[];
  /** Signatur-grej: något som växer ur karaktären och spricker (bubbelgum, ånga, hjärtan …). off/bone som i anatomy (munnen). */
  bubble?: { color: string; bone: string; off: Vec3; size: number; every: number };
  /** 3D-regn i heron (färgade kulor). */
  rain?: { colors: string[]; count: number };
  /** Jätteordet bakom karaktären i heron. */
  heroWord?: string;
  /** Rader i tejpen mellan sektionerna. */
  marquee: string[];
  disclaimer: string;
}

/**
 * Format "world": liten ö där karaktären går omkring (WASD/piltangenter, klick/tap på marken, eller klick på en plats).
 * Platserna = props med `open` (hus → about, bio → memes, kiosk → buy …). Går man fram till en plats visas en knapp som öppnar sektionen.
 * Koordinater: öns mitt är (0,0,0), marken y = 0, `radius` = hur långt man kan gå. Props utan rotY vänds automatiskt mot mitten.
 */
export interface WorldFormat {
  /** "sky" = flytande ö med klippig undersida över ett molnhav. "sea" = ö i ett lågpoly-hav med strand. */
  kind: "sky" | "sea";
  radius: number;
  ground: { grass: string; grass2: string; path: string; sand: string; rock: string; rock2: string };
  /** Färger för havet ("sea") eller molnen under ön ("sky"). */
  water: { shallow: string; deep: string };
  sky: { top: string; bottom: string; sun: string };
  lights: { sun: string; sunIntensity: number; ambient: number; ground: string };
  /** Kameran följer karaktären: avstånd, höjd över marken, fov. Dra för att vrida, scrolla för zoom. */
  camera: { dist: number; height: number; fov: number };
  spawn: Vec3;
  /** Grusstigar från mitten till varje plats. */
  paths?: boolean;
  /** Brygga vid kanten (vinkel i radianer, 0 = mot kameran/söder) med en brevlåda som öppnar t.ex. X. */
  pier?: { angle: number; open?: OpenTarget; label?: string };
  /** Levande skärmar på props (samma som room, t.ex. memes på bioduken). */
  screens?: ScreenConfig[];
  /** Småsaker på gräset: blommor i dessa färger, antal grästuvor, antal stenar. */
  decor?: { flowers?: string[]; tufts?: number; rocks?: number };
  particles?: { kind: ParticleKind; count: number; color: string };
  /** Namnet på gång-klippet i character.clips (annars glider karaktären). */
  walkClip?: string;
  /** Gånghastighet i karaktärshöjder per sekund (standard 1.3). */
  speed?: number;
}

/**
 * Format "toy": karaktären som leksak på en snurrande piedestal. Klappa (dra över den), mata, kasta garn, bonka (klick).
 * Humör-mätare (kärlek + mjölk) sparas per besökare. "Play" startar ett arkadspel: fånga det som faller, undvik röda ljus.
 * Med CA växer karaktären med market cap (Dexscreener) enligt milstolparna.
 */
export interface ToyFormat {
  /** Bakgrundens två färger (mjuk gradient med prickar). */
  bg: [string, string];
  /** Piedestalens färger (ränder + kant). */
  stage: { color: string; color2: string };
  /** Bokstavsklossar med tickern runt piedestalen. */
  blocks?: boolean;
  /** GLB:er som används som godis/leksak (t.ex. mjölkpaket och garnnystan från props). */
  treats: { feed: string; toy: string };
  /** Namn på knapparna. */
  actions?: { pet?: string; feed?: string; toy?: string; bonk?: string; play?: string };
  /** Arkadspelet. good = saker som ger poäng (GLB + poäng). Röda ljus = minus ett liv, gröna ljus = +5. */
  game: { title: string; good: { file: string; points: number; height: number }[] };
  /** Karaktären växer med market cap. at = mcap i USD. */
  mcap?: { milestones: { at: number; scale: number; label: string }[] };
  /** Repliker per situation (utöver character.quotes). */
  lines: { pet: string[]; feed: string[]; bonk: string[]; hungry: string[]; toy: string[]; gameOver: string[] };
}

/**
 * Intro före sajten (valfritt, funkar med alla format). Ersätter den vanliga laddnings-/ENTER-skärmen.
 * film  = regisserade kameraåkningar vid havet i solnedgång, filmbalkar, glas-ENTER → warp + vit blixt in på sajten.
 * dream = karaktären sover (flyter på havet / ligger på ett moln), drömmer om memes, ögonlocken stängs → vaknar på sajten.
 * vhs   = hemmavideo: blå skärm → PAUSE → ▶ PLAY, karaktären vinkar/dansar, brus → sajten.
 * cctv  = övervakningskamera: växlande vinklar, REC, rörelseruta på karaktären → ACCESS FEED zoomar in → sajten.
 */
export interface IntroConfig {
  kind: "film" | "dream" | "vhs" | "cctv";
  /** Rader som visas under introt: film = "förtexter", vhs = etikett på bandet, cctv = kameraplats. */
  lines?: string[];
  /** film: himmel [topp, horisont], hav, sol. */
  film?: { sky: [string, string]; sea: string; sun: string; land: string };
  /** dream: var karaktären sover. */
  dream?: { setting: "sea" | "clouds" };
  /** Text på ENTER-knappen (standard beror på intro). */
  enter?: string;
}

/** Ljud skapat i kod (WebAudio) — inga ljudfiler. */
export interface SoundConfig {
  /** Stämningsmatta i bakgrunden på hela sajten. "off" = bara UI-ljud. */
  ambience?: "warm" | "night" | "dreamy" | "arcade" | "off";
}

export interface SiteConfig {
  format: Format;
  skin?: Skin;
  name: string;
  ticker: string;         // "$GRILA"
  tagline: string;
  chain: "solana" | "robinhood" | "base" | "eth";
  ca: string;             // "" = coming soon
  links: { x?: string; dex?: string; buy?: string; telegram?: string };
  lore: string[];
  howToBuy: { t: string; d: string }[];
  memes: string[];
  music?: string;
  palette: Palette;
  fonts: { display: string; body: string };
  loaderText: string;     // "entering grila's office..."
  hint: string;           // "drag to look around · click stuff"
  character: CharacterConfig;
  /** GLB-props (används av room/world; övriga format kan ignorera dem). */
  props: PropConfig[];
  post: PostConfig;
  room?: RoomFormat;
  os?: OsFormat;
  landing?: LandingFormat;
  world?: WorldFormat;
  toy?: ToyFormat;
  intro?: IntroConfig;
  sound?: SoundConfig;
  /** Knapparna i dockan längst ned (samma sektioner som hotspotsen). */
  dock: { label: string; open: OpenTarget }[];
}
