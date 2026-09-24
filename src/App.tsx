import { useEffect, useRef, useState, useCallback, lazy, Suspense, useMemo } from "react";
import { site } from "./site.config";
import type { OpenTarget, Section } from "./types";
import { FORMATS } from "./formats";
import type { FormatHandle } from "./formats/types";
import { sfx, unlockAudio, setSfxMuted, startAmbience, stopAmbience } from "./ui/sfx";
import IntroView from "./intro/IntroView";
import { Panel } from "./ui/Panel";

const P = site.palette;
const cssVars = {
  "--bg": P.bg, "--accent": P.accent, "--accent2": P.accent2, "--ink": P.ink, "--panel": P.panel, "--panel-ink": P.panelInk,
  "--font-display": `"${site.fonts.display}", Impact, sans-serif`, "--font-body": `"${site.fonts.body}", system-ui, sans-serif`,
} as React.CSSProperties;

const LINKS: Record<string, string | undefined> = { x: site.links.x, dex: site.links.dex, buy: site.links.buy, telegram: site.links.telegram };
const def = FORMATS[site.format] ?? FORMATS.room!;
const hasIntro = !!site.intro && !location.search.includes("edit") && !location.search.includes("nointro");

export default function App() {
  const View = useMemo(() => lazy(def.load), []);
  const fmt = useRef<FormatHandle>(null);
  const music = useRef<HTMLAudioElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [entered, setEntered] = useState(false);
  const [section, setSection] = useState<Section | null>(null);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState(true);

  const onOpen = useCallback((t: OpenTarget) => {
    if (t.startsWith("link:")) { const u = LINKS[t.slice(5)]; if (u) window.open(u, "_blank", "noopener"); return; }
    sfx("open"); setSection(t as Section);
  }, []);

  useEffect(() => {
    if (location.search.includes("edit") && progress >= 1 && !entered) { fmt.current?.enter(); setEntered(true); }
  }, [progress, entered]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape" && section) close(); };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  });

  /** Ljud när sajten öppnas: musikfil om den finns, annars syntad stämningsmatta (sound.ambience). */
  const startSound = () => {
    unlockAudio();
    if (site.music) { const a = new Audio(site.music); a.loop = true; a.volume = 0.45; a.muted = muted; a.play().catch(() => {}); music.current = a; }
    const amb = site.sound?.ambience;
    if (amb && amb !== "off" && !site.music) startAmbience(amb, 0.8); else stopAmbience(1.6);
  };
  const enter = () => {
    sfx("click"); startSound();
    fmt.current?.enter(); setEntered(true);
    setTimeout(() => setHint(false), 7000);
  };
  // med intro: introt sköter ENTER, sajten tar över när introt är klart
  const introDone = () => { startSound(); fmt.current?.enter(); setEntered(true); setTimeout(() => setHint(false), 8000); };
  const close = useCallback(() => { setSection(null); fmt.current?.closePanel(); }, []);
  const go = (t: OpenTarget) => { sfx("click"); if (section) setSection(null); fmt.current?.open(t); };
  const toggleMute = () => { const m = !muted; setMuted(m); setSfxMuted(m); if (music.current) music.current.muted = m; };
  const copyCA = () => {
    if (!site.ca) return;
    navigator.clipboard?.writeText(site.ca).then(() => { setCopied(true); sfx("copy"); setTimeout(() => setCopied(false), 1400); });
  };
  const ready = progress >= 1;
  const shellUI = !def.ownUI;
  const boot = site.format === "os" ? site.os?.bootLines : undefined;

  return (
    <div className={`app skin-${site.skin ?? "brutal"} fmt-${site.format}`} style={cssVars}>
      <Suspense fallback={null}>
        <View ref={fmt} site={site} onProgress={setProgress} onOpen={onOpen} sfx={sfx} />
      </Suspense>

      {hasIntro && <IntroView site={site} siteProgress={progress} onEnter={() => unlockAudio()} onDone={introDone} sfx={sfx} />}

      {/* ---------- GATE ---------- */}
      {!hasIntro && <div className={`gate ${entered ? "gone" : ""} ${boot ? "boot" : ""}`}>
        <div className="gate-inner">
          {boot && (
            <pre className="boot-lines">{boot.slice(0, Math.max(1, Math.ceil(progress * boot.length))).join("\n")}<i className="cursor">_</i></pre>
          )}
          <div className="gate-title">{site.name}</div>
          <div className="gate-sub">{site.tagline}</div>
          {!ready ? (
            <>
              <div className="bar"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <div className="gate-load">{site.loaderText} {Math.round(progress * 100)}%</div>
            </>
          ) : (
            <button className="enter" onClick={enter}>{boot ? "PRESS START" : "ENTER"}</button>
          )}
        </div>
      </div>}

      {shellUI && (
        <>
          <header className={`hud ${entered ? "on" : ""}`}>
            <div className="brand" onClick={() => go("about")}>{site.ticker}</div>
            <div className="hud-right">
              <button className={`ca ${copied ? "copied" : ""}`} onClick={copyCA} title={site.ca || "coming soon"}>
                <span>CA</span>{copied ? "copied!" : site.ca ? site.ca.slice(0, 4) + "…" + site.ca.slice(-4) : "coming soon"}
              </button>
              {site.links.x && <a className="pill" href={site.links.x} target="_blank" rel="noopener noreferrer" aria-label="X">𝕏</a>}
              {site.links.dex && <a className="pill" href={site.links.dex} target="_blank" rel="noopener noreferrer">DEX</a>}
              {site.links.buy && <a className="pill buy" href={site.links.buy} target="_blank" rel="noopener noreferrer">BUY</a>}
            </div>
          </header>
          <nav className={`dock ${entered ? "on" : ""}`}>
            {site.dock.map((d) => (
              <button key={d.label} className={section && d.open === section ? "active" : ""} onClick={() => go(d.open)}>{d.label}</button>
            ))}
          </nav>
          <div className={`hint ${entered && hint ? "on" : ""}`}>{site.hint}</div>
          <Panel section={section} onClose={close} onCopy={copyCA} copied={copied} />
        </>
      )}
      <button className={`mute ${entered ? "on" : ""}`} onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>{muted ? "🔇" : "🔊"}</button>
    </div>
  );
}
