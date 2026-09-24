import { useState } from "react";
import { site } from "../site.config";
import type { Section } from "../types";

export const TITLES: Record<Section, string> = { about: "ABOUT", memes: "MEMES", buy: "HOW TO BUY", chart: "CHART" };

export function dexEmbed() {
  if (!site.ca) return null;
  const chain = site.chain === "eth" ? "ethereum" : site.chain;
  return `https://dexscreener.com/${chain}/${site.ca}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15`;
}

function CaBox({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  return (
    <button className="ca-box" onClick={onCopy}>
      <small>CONTRACT</small>
      <b>{site.ca || "coming soon…"}</b>
      {site.ca && <em>{copied ? "copied!" : "click to copy"}</em>}
    </button>
  );
}

/** Innehållet i en sektion — används av skalets panel och av formatens egna fönster. */
export function SectionBody({ section, onCopy, copied, onZoom }: { section: Section; onCopy: () => void; copied: boolean; onZoom: (src: string) => void }) {
  if (section === "about") return (
    <>
      <h2 className="panel-title">{site.name}</h2>
      {site.lore.map((p, i) => <p key={i}>{p}</p>)}
      <CaBox onCopy={onCopy} copied={copied} />
    </>
  );
  if (section === "memes") return (
    <div className="meme-grid">
      {site.memes.map((m) => <button key={m} onClick={() => onZoom(m)}><img src={m} alt="" loading="lazy" /></button>)}
    </div>
  );
  if (section === "buy") return (
    <>
      <ol className="steps">{site.howToBuy.map((s, i) => <li key={i}><b>{s.t}</b><span>{s.d}</span></li>)}</ol>
      <CaBox onCopy={onCopy} copied={copied} />
      {site.links.buy && <a className="big-buy" href={site.links.buy} target="_blank" rel="noopener noreferrer">BUY {site.ticker}</a>}
    </>
  );
  const dex = dexEmbed();
  return dex ? <iframe className="dex" src={dex} title="chart" /> : <div className="soon"><b>{site.ticker}</b><span>chart goes live at launch</span></div>;
}

export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  return src ? <div className="lightbox" onClick={onClose}><img src={src} alt="" /></div> : null;
}

export function Panel({ section, onClose, onCopy, copied }: { section: Section | null; onClose: () => void; onCopy: () => void; copied: boolean }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const shown = section ?? "about";
  return (
    <>
      <aside className={`panel ${section ? "open" : ""}`} aria-hidden={!section}>
        <div className="panel-head">
          <span>{TITLES[shown]}</span>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="panel-body"><SectionBody section={shown} onCopy={onCopy} copied={copied} onZoom={setZoom} /></div>
      </aside>
      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </>
  );
}
