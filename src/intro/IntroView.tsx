import { useEffect, useRef, useState } from "react";
import type { SiteConfig } from "../types";
import type { IntroBase, IntroDom, Sfx } from "./base";
import { startAmbience, unlockAudio, type Ambience } from "../ui/sfx";
import "./intro.css";

const LOADERS = {
  film: () => import("./film").then((m) => m.FilmIntro),
  dream: () => import("./dream").then((m) => m.DreamIntro),
  vhs: () => import("./tape").then((m) => m.TapeIntro),
  cctv: () => import("./tape").then((m) => m.TapeIntro),
};
const MOOD: Record<keyof typeof LOADERS, Ambience> = { film: "warm", dream: "dreamy", vhs: "tape", cctv: "cctv" };

interface Props {
  site: SiteConfig;
  /** Sajtens (formatets) laddning 0..1 — ENTER visas först när både intro och sajt är klara. */
  siteProgress: number;
  /** ENTER klickad (användargest → ljud får starta). */
  onEnter: () => void;
  /** Introt är slut → formatet ska köra sin egen entré medan skyddet tonas bort. */
  onDone: () => void;
  sfx: Sfx;
}

/** Overlay som spelar introt ovanpå sajten. Egen canvas; tas bort när introt är klart. */
export default function IntroView({ site, siteProgress, onEnter, onDone, sfx }: Props) {
  const kind = site.intro!.kind;
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const refs = { credits: useRef<HTMLDivElement>(null), osd: useRef<HTMLDivElement>(null), sub: useRef<HTMLDivElement>(null), box: useRef<HTMLDivElement>(null), bubble: useRef<HTMLDivElement>(null), bubbleImg: useRef<HTMLImageElement>(null), dots: useRef<HTMLDivElement>(null), zzz: useRef<HTMLDivElement>(null) };
  const eng = useRef<IntroBase | null>(null);
  const [prog, setProg] = useState(0);
  const [enterable, setEnterable] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "playing" | "reveal" | "gone">("loading");
  const [label, setLabel] = useState("ENTER");
  const audio = useRef(false);
  const ready = prog >= 1 && siteProgress >= 1;

  useEffect(() => {
    let alive = true;
    const dom: IntroDom = {
      root: root.current!, credits: refs.credits.current!, osd: refs.osd.current!, sub: refs.sub.current!, box: refs.box.current!,
      bubble: refs.bubble.current!, bubbleImg: refs.bubbleImg.current!, dots: refs.dots.current!, zzz: refs.zzz.current!,
    };
    LOADERS[kind]().then((Cls) => {
      if (!alive) return;
      const e = new Cls(host.current!, site, dom, {
        onProgress: (p) => setProg(p),
        onEnterable: () => setEnterable(true),
        onDone: () => {
          setPhase("reveal"); onDone();
          setTimeout(() => { eng.current?.dispose(); eng.current = null; }, 60);
          setTimeout(() => setPhase("gone"), 1400);
        },
        sfx,
      });
      eng.current = e; setLabel(e.enterLabel()); e.load();
    });
    // första gesten låser upp ljudet → stämningsmatta för introt
    const wake = () => { if (audio.current) return; audio.current = true; unlockAudio(); startAmbience(MOOD[kind], 0.9); };
    addEventListener("pointerdown", wake); addEventListener("keydown", wake);
    return () => { alive = false; removeEventListener("pointerdown", wake); removeEventListener("keydown", wake); eng.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (ready && phase === "loading") { setPhase("ready"); eng.current?.go(); } }, [ready, phase]);

  const enter = () => {
    if (phase !== "ready" || !enterable) return;
    if (!audio.current) { audio.current = true; unlockAudio(); startAmbience(MOOD[kind], 0.9); }
    sfx("click"); onEnter(); setPhase("playing"); eng.current?.start();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") enter(); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  });

  if (phase === "gone") return null;
  const pct = Math.round(Math.min(prog, siteProgress) * 100);
  return (
    <div ref={root} className={`ix ix-${kind} ${phase} ${enterable ? "enterable" : ""}`} style={{ ["--flash" as string]: 0 }}>
      <div ref={host} className="ix-canvas" />
      <div className="ix-vig" /><div className="ix-grain" />
      <div className="ix-bar t" /><div className="ix-bar b" />
      <div ref={refs.credits} className="ix-credits" />
      <div ref={refs.osd} className="ix-osd" />
      <div ref={refs.sub} className="ix-sub" />
      <div ref={refs.box} className="ix-box"><span /></div>
      <div ref={refs.dots} className="ix-dots"><i /><i /><i /></div>
      <div ref={refs.bubble} className="ix-bubble"><img ref={refs.bubbleImg} alt="" /></div>
      <div ref={refs.zzz} className="ix-zzz"><b>z</b><b>z</b><b>Z</b></div>
      <div className="ix-title">{site.name}</div>
      <div className="ix-load">
        <div className="ix-mark">{kind === "vhs" ? "VIDEO 1" : kind === "cctv" ? "CONNECTING…" : site.ticker}</div>
        <div className="ix-meter"><i style={{ width: `${pct}%` }} /></div>
        <div className="ix-pct">{pct < 100 ? `LOADING ${pct}%` : "READY"}</div>
      </div>
      <button className="ix-enter" onClick={enter} aria-label="Enter site">{label}</button>
      {kind === "film" && <button className="ix-skip" onClick={() => { sfx("click"); eng.current?.skip(); }}>skip</button>}
      <div className="ix-cover" />
    </div>
  );
}
