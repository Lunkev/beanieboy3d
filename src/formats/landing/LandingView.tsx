import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import type { FormatHandle, FormatProps } from "../types";
import type { FilmBeat } from "../../types";
import { Lightbox, dexEmbed } from "../../ui/Panel";
import { Film } from "./film";
import "./landing.css";

/** Format "landing" = scroll-film. Se Film (film.ts) för motorn; här ritas sektionerna, pilarna, menyn och knapparna. */
const LandingView = forwardRef<FormatHandle, FormatProps>(function LandingView({ site, onProgress, onOpen, sfx }, ref) {
  const L = site.landing!;
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const secs = useRef<HTMLElement[]>([]);
  const lines = useRef<(SVGGElement | null)[]>([]);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const bubbleEl = useRef<HTMLDivElement>(null);
  const film = useRef<Film | null>(null);
  const [active, setActive] = useState(0);
  const [entered, setEntered] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [quote, setQuote] = useState<string | null>(null);
  const dex = dexEmbed();

  useEffect(() => {
    const f = new Film(host.current!, site, {
      onProgress,
      onBeat: (i) => { setActive(i); if (L.beats[i]?.kind === "dash") sfx("whoosh"); },
      onPop: () => sfx("pop"),
      onPoke: () => say(),
    }, root.current!);
    film.current = f;
    if (import.meta.env.DEV) (window as unknown as { film: Film }).film = f;
    f.setSections(secs.current.filter(Boolean));
    const anat = L.beats.findIndex((b) => b.kind === "anatomy");
    const tmp = new THREE.Vector3();
    f.onFrame = () => {
      // anatomipilar: linje från etikettens kant till benets skärmpunkt
      const sec = secs.current[anat];
      const p = sec ? parseFloat(sec.style.getPropertyValue("--p") || "0") : 0;
      const n = f.points.length;
      f.points.forEach((pt, j) => {
        const g = lines.current[j], lab = labels.current[j]; if (!g || !lab) return;
        const at = 0.08 + (j / n) * 0.6;
        const vis = sec?.classList.contains("on") ? Math.min(1, Math.max(0, (p - at) * 8)) * (1 - Math.max(0, (p - 0.93) * 14)) : 0;
        const r = lab.getBoundingClientRect();
        const left = r.left + r.width / 2 < pt.x;
        const x1 = left ? r.right + 6 : r.left - 6, y1 = r.top + r.height / 2;
        const ln = g.children[0] as SVGLineElement, c = g.children[1] as SVGCircleElement, c2 = g.children[2] as SVGCircleElement;
        const ex = x1 + (pt.x - x1) * Math.min(1, vis * 1.2), ey = y1 + (pt.y - y1) * Math.min(1, vis * 1.2);
        ln.setAttribute("x1", `${x1}`); ln.setAttribute("y1", `${y1}`); ln.setAttribute("x2", `${ex}`); ln.setAttribute("y2", `${ey}`);
        c.setAttribute("cx", `${pt.x}`); c.setAttribute("cy", `${pt.y}`); c2.setAttribute("cx", `${pt.x}`); c2.setAttribute("cy", `${pt.y}`);
        g.style.opacity = String(pt.vis ? vis : 0);
      });
      // pratbubbla ovanför huvudet
      if (bubbleEl.current && f.char) {
        const hw = f.char.headWorld(); tmp.copy(hw).project(f.camera);
        bubbleEl.current.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${(-tmp.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
      }
    };
    f.load();
    return () => f.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = (t?: string) => {
    const q = site.character.quotes; if (!q.length && !t) return;
    const s = t ?? q[Math.floor(Math.random() * q.length)];
    setQuote(s); setTimeout(() => setQuote((c) => (c === s ? null : c)), 2800);
  };
  useEffect(() => { if (entered) { const id = setTimeout(() => say(site.character.quotes[0]), 1400); return () => clearTimeout(id); } }, [entered]); // eslint-disable-line react-hooks/exhaustive-deps

  const goto = (i: number) => {
    const el = secs.current[i]; if (!el) return;
    sfx("click");
    const span = Math.max(0, el.offsetHeight - innerHeight);
    scrollTo({ top: el.offsetTop + span * 0.35, behavior: "smooth" });
  };
  const gotoKind = (k: string) => { const i = L.beats.findIndex((b) => b.kind === k || b.id === k); if (i >= 0) goto(i); };

  useImperativeHandle(ref, () => ({
    enter: () => { setEntered(true); scrollTo({ top: 0 }); },
    open: (t) => { if (t.startsWith("link:")) return onOpen(t); gotoKind(t === "about" ? "story" : t === "chart" ? "buy" : t); },
    closePanel: () => {},
  }));

  const copyCA = () => { if (!site.ca) return; navigator.clipboard?.writeText(site.ca).then(() => { setCopied(true); sfx("copy"); setTimeout(() => setCopied(false), 1400); }); };
  const dark = (hex?: string) => { if (!hex) return false; const c = new THREE.Color(hex); return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 < 0.3; };
  const word = L.heroWord ?? site.ticker.replace(/^\$/, "");
  const buyBtn = site.links.buy && <a className="lf-btn big" href={site.links.buy} target="_blank" rel="noopener noreferrer">BUY {site.ticker}</a>;
  const caBtn = <button className="lf-btn big ghost" onClick={copyCA}>{copied ? "COPIED!" : site.ca ? "COPY CA" : "CA COMING SOON"}</button>;

  const head = (b: FilmBeat, h1 = false) => (
    <div className="lf-head lf-rise">
      {b.kicker && <span className="lf-kicker">{b.kicker}</span>}
      {h1 ? <h1 className="lf-title">{b.title}</h1> : <h2 className="lf-title">{b.title}</h2>}
      {b.body && <p className="lf-body">{b.body}</p>}
    </div>
  );

  const content = (b: FilmBeat) => {
    const side = b.cam.side;
    const pos = side > 0 ? "left" : side < 0 ? "right" : "center";
    switch (b.kind) {
      case "hero":
        return (
          <div className="lf-hero-ui">
            <div className="lf-hero-copy lf-rise">
              {b.kicker && <span className="lf-kicker">{b.kicker}</span>}
              <h1 className="lf-sr">{b.title}</h1>
              <p className="lf-body">{b.body ?? site.tagline}</p>
              <div className="lf-cta">{buyBtn}{caBtn}</div>
            </div>
            <div className="lf-scrollhint">scroll</div>
          </div>
        );
      case "anatomy":
        return (
          <>
            <div className={`lf-col ${pos} top`}>{head(b)}</div>
            {(L.anatomy ?? []).map((a, j, all) => (
              <div key={j} ref={(el) => { labels.current[j] = el; }} className={`lf-callout ${j % 2 ? "r" : "l"}`}
                style={{ "--at": 0.08 + (j / all.length) * 0.6, top: `${34 + j * (50 / Math.max(1, all.length - 1))}%` } as CSSProperties}>
                <b>{a.title}</b><span>{a.body}</span>
              </div>
            ))}
          </>
        );
      case "routine":
        return (
          <>
            <div className="lf-col center top">{head(b)}</div>
            <ol className="lf-routine">
              {(L.routine ?? []).map((r, j, all) => (
                <li key={j} className={`lf-card ${j % 2 ? "r" : "l"}`} style={{ "--at": 0.1 + (j / all.length) * 0.55 } as CSSProperties} onClick={() => setZoom(r.img)}>
                  <img src={r.img} alt="" loading="lazy" />
                  <div><em>{String(j + 1).padStart(2, "0")}</em><b>{r.title}</b><span>{r.body}</span></div>
                </li>
              ))}
            </ol>
          </>
        );
      case "memes":
        return (
          <>
            <div className={`lf-col ${pos} top compact`}>{head(b)}</div>
            <div className={`lf-memes-stack ${side > 0 ? "at-left" : "at-right"}`}>
              {site.memes.map((m, j, all) => (
                <img key={m} src={m} alt="" loading="lazy" onClick={() => setZoom(m)}
                  style={{ "--at": (j / all.length) * 0.8, "--n": all.length, "--r": `${((j * 37) % 17) - 8}deg`, "--dx": `${((j * 53) % 60) - 30}px`, "--dy": `${((j * 29) % 40) - 20}px`, zIndex: j } as CSSProperties} />
              ))}
            </div>
          </>
        );
      case "dash":
        return (
          <div className="lf-dash">
            <div className="lf-speed" />
            <div className="lf-dash-word">{b.title}</div>
            {b.body && <p className="lf-body lf-dash-body">{b.body}</p>}
          </div>
        );
      case "buy":
        return (
          <div className={`lf-col ${pos} wide`}>
            {head(b)}
            <ol className="lf-steps lf-rise">{site.howToBuy.map((s, i) => <li key={i}><em>{i + 1}</em><b>{s.t}</b><span>{s.d}</span></li>)}</ol>
            <button className="lf-cabox lf-rise" onClick={copyCA}><small>CONTRACT ADDRESS</small><b>{site.ca || "COMING SOON"}</b>{site.ca && <em>{copied ? "copied!" : "tap to copy"}</em>}</button>
            <div className="lf-cta lf-rise">{buyBtn}{dex && site.links.dex && <a className="lf-btn big ghost" href={site.links.dex} target="_blank" rel="noopener noreferrer">CHART</a>}</div>
          </div>
        );
      case "outro":
        return (
          <div className="lf-outro">
            <div className="lf-outro-word">{site.ticker}</div>
            <p className="lf-body">{b.body}</p>
            <div className="lf-cta">{buyBtn}{site.links.x && <a className="lf-btn big ghost" href={site.links.x} target="_blank" rel="noopener noreferrer">𝕏 COMMUNITY</a>}</div>
            <small className="lf-disclaimer">{L.disclaimer}</small>
          </div>
        );
      default:
        return <div className={`lf-col ${pos}`}>{head(b)}</div>;
    }
  };

  const tapeAfter = new Set(["hero", "memes"]);
  const tape = [...L.marquee, ...L.marquee, ...L.marquee];
  const navItems = L.beats.map((b, i) => ({ b, i })).filter(({ b }) => b.nav);
  const isDark = dark(L.beats[active]?.bg);

  return (
    <div ref={root} className={`lf ${entered ? "in" : ""} ${isDark ? "dark" : ""}`}>
      <div className="lf-bg" aria-hidden="true">
        <div className="lf-rings"><i /><i /><i /><i /><i /><i /></div>
        <div className={`lf-word ${active === 0 ? "" : "off"}`}>{word}</div>
      </div>
      <div ref={host} className="lf-canvas" />
      <svg className="lf-lines" aria-hidden="true">
        {(L.anatomy ?? []).map((_, j) => (
          <g key={j} ref={(el) => { lines.current[j] = el; }} style={{ opacity: 0 }}>
            <line /><circle r="13" className="halo" /><circle r="5" />
          </g>
        ))}
      </svg>
      <div ref={bubbleEl} className={`lf-say ${quote ? "show" : ""}`}>{quote}</div>

      <nav className="lf-nav">
        <button className="lf-logo" onClick={() => goto(0)}>{site.ticker}</button>
        <div className="lf-links">{navItems.map(({ b, i }) => <button key={b.id} className={active === i ? "on" : ""} onClick={() => goto(i)}>{b.nav}</button>)}</div>
        <div className="lf-actions">
          <button className="lf-pill" onClick={copyCA}>{copied ? "COPIED" : site.ca ? `CA ${site.ca.slice(0, 4)}…${site.ca.slice(-4)}` : "CA SOON"}</button>
          {site.links.x && <a className="lf-pill" href={site.links.x} target="_blank" rel="noopener noreferrer" aria-label="X">𝕏</a>}
          {site.links.buy && <a className="lf-pill buy" href={site.links.buy} target="_blank" rel="noopener noreferrer">BUY</a>}
        </div>
      </nav>
      <aside className="lf-chapters">
        {L.beats.map((b, i) => <button key={b.id} className={active === i ? "on" : ""} onClick={() => goto(i)} aria-label={b.nav ?? b.id}><span>{b.nav ?? b.kicker ?? b.id}</span></button>)}
      </aside>

      <main className="lf-main">
        {L.beats.map((b, i) => (
          <div key={b.id}>
            <section id={`lf-${b.id}`} ref={(el) => { if (el) secs.current[i] = el; }}
              className={`lf-sec k-${b.kind} ${dark(b.bg) ? "is-dark" : ""}`} style={{ height: `${(b.screens ?? 2) * 100}svh` }}>
              <div className="lf-sticky">{content(b)}</div>
            </section>
            {tapeAfter.has(b.kind) && <div className="lf-tape"><div>{tape.map((t, j) => <span key={j}>{t}<i>✦</i></span>)}</div></div>}
          </div>
        ))}
      </main>
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </div>
  );
});

export default LandingView;
