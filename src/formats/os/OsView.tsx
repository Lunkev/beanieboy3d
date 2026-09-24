import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FormatHandle, FormatProps } from "../types";
import type { OpenTarget, Section } from "../../types";
import { SectionBody, Lightbox, TITLES } from "../../ui/Panel";
import { Viewer, type ViewMode } from "./viewer";
import { Pet } from "./pet";
import { isMobile } from "../../core/util";
import "./os.css";

type AppId = Section | "viewer" | "terminal" | "trash";
interface Win { id: AppId; x: number; y: number; w: number; h: number; z: number; min: boolean; max: boolean }

const ICON_FALLBACK: Record<string, string> = { about: "📄", memes: "🖼️", buy: "🛒", chart: "📈", viewer: "🧊", terminal: "⌨️", trash: "🗑️" };

/** Format "os": fejk-operativsystem med fönster, 3D-visare, terminal och desktop-pet. */
const OsView = forwardRef<FormatHandle, FormatProps>(function OsView({ site, onProgress, onOpen, sfx }, ref) {
  const os = site.os!;
  const [wins, setWins] = useState<Win[]>([]);
  const [booted, setBooted] = useState(false);
  const [start, setStart] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState("");
  const [bubble, setBubble] = useState<string | null>(null);
  const top = useRef(10);
  const petHost = useRef<HTMLDivElement>(null);
  const petHit = useRef<HTMLDivElement>(null);
  const bubbleEl = useRef<HTMLDivElement>(null);
  const pet = useRef<Pet | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const taskbarH = os.theme === "mac" ? 0 : 40;

  // ---- laddning: pet-modellen (den stora grejen) + bilder ----
  useEffect(() => {
    let p = 0.1; onProgress(p);
    const tick = setInterval(() => { p = Math.min(0.9, p + 0.07); onProgress(p); }, 200);
    const img = new Image(); img.src = os.wallpaper;
    const petOn = !!os.pet && !isMobile;
    const done = () => { clearInterval(tick); onProgress(1); };
    if (petOn) {
      const pt = new Pet(petHost.current!, petHit.current!, site.character, os.pet!.height, os.pet!.walkClip, () => (os.theme === "mac" ? 70 : taskbarH) + 2);
      pet.current = pt; pt.load().then(done);
    } else setTimeout(done, 600);
    const c = setInterval(() => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })), 1000);
    return () => { clearInterval(tick); clearInterval(c); pet.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pratbubbla följer peten
  useEffect(() => {
    let raf = 0;
    const loop = () => { if (bubbleEl.current && pet.current?.char) { const h = pet.current.headScreen(); bubbleEl.current.style.transform = `translate(${h.x}px, ${h.y}px) translate(-50%, -100%)`; } raf = requestAnimationFrame(loop); };
    loop(); return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (!booted) return;
    const q = site.character.quotes; if (!q.length) return;
    const id = setInterval(() => say(q[Math.floor(Math.random() * q.length)]), 13000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted]);
  const say = (t: string) => { setBubble(t); setTimeout(() => setBubble((b) => (b === t ? null : b)), 3500); };

  const layout = (id: AppId, n: number): Omit<Win, "id" | "z" | "min" | "max"> => {
    const W = innerWidth, H = innerHeight - taskbarH;
    if (isMobile) return { x: 6, y: os.theme === "mac" ? 30 : 6, w: W - 12, h: H - 60 };
    const size: Record<AppId, [number, number]> = { viewer: [520, 560], about: [480, 520], memes: [560, 520], buy: [420, 540], chart: [640, 460], terminal: [560, 340], trash: [320, 200] };
    const [w, h] = size[id];
    // första fönstret till vänster, andra till höger om det, sedan kaskad
    const x = n === 0 ? 130 : n === 1 ? Math.min(W - w - 30, 130 + 540) : 180 + (n - 2) * 36;
    const y = n <= 1 ? 30 : 60 + (n - 2) * 30;
    return { x: Math.max(0, Math.min(W - w - 10, x)), y: Math.max(0, Math.min(H - h - 10, y)), w, h };
  };

  const openApp = useCallback((id: AppId) => {
    setStart(false); sfx("open");
    setWins((ws) => {
      const ex = ws.find((w) => w.id === id);
      if (ex) return ws.map((w) => (w.id === id ? { ...w, min: false, z: ++top.current } : w));
      return [...ws, { id, ...layout(id, ws.length), z: ++top.current, min: false, max: isMobile }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTarget = (t: OpenTarget | "viewer" | "terminal" | "trash") => {
    if (typeof t === "string" && t.startsWith("link:")) { onOpen(t as OpenTarget); return; }
    openApp(t as AppId);
  };

  useImperativeHandle(ref, () => ({
    enter: () => { setBooted(true); setTimeout(() => openApp("viewer"), 500); setTimeout(() => !isMobile && openApp("about"), 900); },
    open: (t) => openTarget(t),
    closePanel: () => {},
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [openApp]);

  const focus = (id: AppId) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, z: ++top.current } : w)));
  const close = (id: AppId) => { sfx("click"); setWins((ws) => ws.filter((w) => w.id !== id)); if (id === "viewer") { viewerRef.current?.dispose(); viewerRef.current = null; } };
  const minimize = (id: AppId) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, min: true } : w)));
  const maximize = (id: AppId) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, max: !w.max } : w)));

  const drag = (id: AppId, e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const w = wins.find((x) => x.id === id); if (!w || w.max) return;
    focus(id);
    const sx = e.clientX, sy = e.clientY, ox = w.x, oy = w.y;
    const move = (ev: PointerEvent) => setWins((ws) => ws.map((x) => (x.id === id ? { ...x, x: Math.max(-x.w + 80, ox + ev.clientX - sx), y: Math.max(0, oy + ev.clientY - sy) } : x)));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };

  const copyCA = () => { if (!site.ca) return; navigator.clipboard?.writeText(site.ca).then(() => { setCopied(true); sfx("copy"); setTimeout(() => setCopied(false), 1400); }); };
  const poke = () => { sfx("pop"); pet.current?.react(); const q = site.character.quotes; if (q.length) say(q[Math.floor(Math.random() * q.length)]); };
  const anim = (name: string) => { viewerRef.current?.play(name); if (pet.current) { pet.current.react(); } };

  const title = (id: AppId) => id === "viewer" ? os.viewer.title : id === "terminal" ? "Terminal" : id === "trash" ? "Recycle Bin" : `${TITLES[id as Section]}`;
  const topWin = wins.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0]?.id;

  return (
    <div className={`os os-${os.theme} ${booted ? "on" : ""}`} onPointerDown={() => start && setStart(false)}>
      <div className="os-wall" style={{ backgroundImage: `url(${os.wallpaper})` }} />
      {os.theme === "mac" && (
        <div className="os-menubar">
          <b> {os.osName}</b><span>File</span><span>Edit</span><span>View</span><span>Special</span>
          <i className="spacer" />
          <button onClick={copyCA}>{copied ? "copied!" : site.ca ? `CA ${site.ca.slice(0, 4)}…${site.ca.slice(-4)}` : "CA soon"}</button>
          <span>{clock}</span>
        </div>
      )}

      <div className="os-icons">
        {os.icons.map((ic) => (
          <button key={ic.label} className="os-icon" onDoubleClick={() => openTarget(ic.open)} onClick={() => (isMobile ? openTarget(ic.open) : sfx("click"))}>
            <span className="glyph">{ic.icon.startsWith("/") ? <img src={ic.icon} alt="" /> : ic.icon || ICON_FALLBACK[ic.open as string] || "📁"}</span>
            <span className="lbl">{ic.label}</span>
          </button>
        ))}
      </div>

      <div ref={petHost} className="os-pet" />
      <div ref={petHit} className="os-pet-hit" onClick={poke} title={site.character.label} />
      <div ref={bubbleEl} className={`bubble ${bubble ? "show" : ""}`}>{bubble}</div>

      {wins.map((w) => (
        <section key={w.id} className={`os-win ${w.min ? "min" : ""} ${w.max ? "max" : ""} ${topWin === w.id ? "active" : ""}`}
          style={w.max ? { zIndex: w.z } : { left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.z }} onPointerDown={() => focus(w.id)}>
          <header className="os-title" onPointerDown={(e) => drag(w.id, e)} onDoubleClick={() => maximize(w.id)}>
            <span className="t">{title(w.id)}</span>
            <span className="btns">
              <button onClick={() => minimize(w.id)} aria-label="minimize">_</button>
              <button onClick={() => maximize(w.id)} aria-label="maximize">□</button>
              <button onClick={() => close(w.id)} aria-label="close">×</button>
            </span>
          </header>
          <div className={`os-body body-${w.id}`}>
            {w.id === "viewer" && <ViewerApp site={site} register={(v) => (viewerRef.current = v)} anim={anim} />}
            {w.id === "terminal" && <Terminal site={site} open={openTarget} anim={anim} copyCA={copyCA} />}
            {w.id === "trash" && <p className="trash">Recycle Bin contains 1 item: <b>paper hands.exe</b></p>}
            {(["about", "memes", "buy", "chart"] as AppId[]).includes(w.id) && <SectionBody section={w.id as Section} onCopy={copyCA} copied={copied} onZoom={setZoom} />}
          </div>
        </section>
      ))}

      {os.theme !== "mac" && (
        <footer className="os-taskbar">
          <button className={`os-start ${start ? "on" : ""}`} onClick={(e) => { e.stopPropagation(); setStart((s) => !s); sfx("click"); }}>
            <span className="flag" /> start
          </button>
          <div className="os-tasks">
            {wins.map((w) => (
              <button key={w.id} className={topWin === w.id ? "on" : ""} onClick={() => (w.min || topWin !== w.id ? setWins((ws) => ws.map((x) => (x.id === w.id ? { ...x, min: false, z: ++top.current } : x))) : minimize(w.id))}>{title(w.id)}</button>
            ))}
          </div>
          <div className="os-tray">
            <button onClick={copyCA}>{copied ? "copied!" : site.ca ? `CA ${site.ca.slice(0, 4)}…` : "CA soon"}</button>
            {site.links.x && <a href={site.links.x} target="_blank" rel="noopener noreferrer">𝕏</a>}
            <span>{clock}</span>
          </div>
        </footer>
      )}
      {os.theme === "mac" && (
        <div className="os-dock">
          {os.icons.map((ic) => <button key={ic.label} onClick={() => openTarget(ic.open)} title={ic.label}>{ic.icon.startsWith("/") ? <img src={ic.icon} alt="" /> : ic.icon || "📁"}</button>)}
        </div>
      )}

      {start && (
        <div className="os-startmenu" onPointerDown={(e) => e.stopPropagation()}>
          <div className="side">{os.osName}</div>
          <ul>
            {os.icons.map((ic) => <li key={ic.label}><button onClick={() => openTarget(ic.open)}><span>{ic.icon.startsWith("/") ? "📁" : ic.icon}</span>{ic.label}</button></li>)}
            <li className="sep" />
            {site.links.buy && <li><a href={site.links.buy} target="_blank" rel="noopener noreferrer"><span>💸</span>Buy {site.ticker}</a></li>}
          </ul>
        </div>
      )}
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
});
export default OsView;

// ---------------- 3D-visaren ----------------
function ViewerApp({ site, register, anim }: { site: FormatProps["site"]; register: (v: Viewer) => void; anim: (n: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const v = useRef<Viewer | null>(null);
  const [mode, setMode] = useState<ViewMode>("textured");
  const [spin, setSpin] = useState(true);
  const [fov, setFov] = useState(35);
  useEffect(() => {
    const vw = new Viewer(host.current!, site.character, site.os!.viewer.bg); v.current = vw; register(vw); vw.load();
    return () => vw.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const modes: ViewMode[] = ["textured", "toon", "wire", "normals"];
  const clips = site.character.reactions ?? [];
  return (
    <div className="viewer">
      <div ref={host} className="viewer-stage" />
      <div className="viewer-bar">
        <button onClick={() => setSpin(v.current!.toggleSpin())} className={spin ? "on" : ""}>⟳ spin</button>
        <button onClick={() => v.current!.flipX()}>⇋ flip X</button>
        <button onClick={() => v.current!.flipY()}>⇵ flip Y</button>
        <button onClick={() => { const m = modes[(modes.indexOf(mode) + 1) % modes.length]; setMode(m); v.current!.mode(m); }}>◐ {mode}</button>
        <label>depth <input type="range" min={15} max={75} value={fov} onChange={(e) => { setFov(+e.target.value); v.current!.depth(+e.target.value); }} /></label>
      </div>
      {clips.length > 0 && <div className="viewer-bar anims">{clips.map((c) => <button key={c} onClick={() => anim(c)}>▶ {c}</button>)}</div>}
    </div>
  );
}

// ---------------- terminalen ----------------
function Terminal({ site, open, anim, copyCA }: { site: FormatProps["site"]; open: (t: OpenTarget | "viewer" | "terminal" | "trash") => void; anim: (n: string) => void; copyCA: () => void }) {
  const T = site.os!.terminal;
  const [lines, setLines] = useState<string[]>(T.motd);
  const [val, setVal] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines]);
  const run = (cmd: string) => {
    const c = cmd.trim().toLowerCase(); const out: string[] = [];
    const custom = T.commands ?? {};
    if (!c) return setLines((l) => [...l, T.prompt]);
    if (c === "help") out.push("commands: help, lore, ca, buy, memes, chart, x, " + (site.character.reactions ?? []).join(", ") + ", clear" + (Object.keys(custom).length ? ", " + Object.keys(custom).join(", ") : ""));
    else if (c === "clear") return setLines([]);
    else if (c === "lore") out.push(...site.lore);
    else if (c === "ca") { out.push(site.ca || "contract: coming soon"); copyCA(); }
    else if (c === "buy") { out.push(...site.howToBuy.map((s, i) => `${i + 1}. ${s.t} — ${s.d}`)); open("buy"); }
    else if (c === "memes" || c === "chart" || c === "about") { out.push(`opening ${c}…`); open(c as Section); }
    else if (c === "x" || c === "twitter") { out.push("opening X…"); open("link:x"); }
    else if ((site.character.reactions ?? []).includes(c)) { out.push(`${site.name.toLowerCase()} is doing: ${c}`); anim(c); }
    else if (custom[c]) out.push(custom[c]);
    else if (c.startsWith("sudo")) out.push("nice try.");
    else out.push(`'${c}' is not recognized. type help`);
    setLines((l) => [...l, `${T.prompt}${cmd}`, ...out]);
  };
  return (
    <div className="term" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
      <form onSubmit={(e) => { e.preventDefault(); run(val); setVal(""); }}>
        <span>{T.prompt}</span><input value={val} onChange={(e) => setVal(e.target.value)} autoFocus spellCheck={false} />
      </form>
      <div ref={end} />
    </div>
  );
}
