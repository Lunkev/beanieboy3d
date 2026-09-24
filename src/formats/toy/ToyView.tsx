import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FormatHandle, FormatProps } from "../types";
import { ToyEngine, type GameState, type McapState, type Mood, type ToyAction } from "./ToyEngine";
import "./toy.css";

/** Format "toy": karaktären som leksak + arkadspel + mcap-tillväxt. Skalets HUD/docka/panel används. */
const ToyView = forwardRef<FormatHandle, FormatProps>(function ToyView({ site, onProgress, onOpen, sfx }, ref) {
  const T = site.toy!;
  const stage = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const eng = useRef<ToyEngine | null>(null);
  const [entered, setEntered] = useState(false);
  const [mood, setMood] = useState<Mood>({ love: 60, milk: 60 });
  const [game, setGame] = useState<GameState>({ mode: "off", score: 0, lives: 3, best: 0 });
  const [mcap, setMcap] = useState<McapState | null>(null);

  useEffect(() => {
    const e = new ToyEngine(stage.current!, site, { bubble: bubble.current! }, { onProgress, onOpen, onSfx: sfx, onMood: setMood, onGame: setGame, onMcap: setMcap });
    eng.current = e; e.load();
    return () => e.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    enter: () => { setEntered(true); eng.current?.enter(); },
    open: (t) => eng.current?.open(t),
    closePanel: () => eng.current?.closePanel(),
  }), []);

  const A = { pet: "pet", feed: "feed", toy: "yarn", bonk: "bonk", play: "play", ...T.actions };
  const act = (a: ToyAction) => { sfx("click"); eng.current?.act(a); };
  const inGame = game.mode !== "off";
  const fmt = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
  const ms = T.mcap?.milestones ?? [];

  return (
    <>
      <div ref={stage} className="stage t-stage" />
      <div ref={bubble} className="bubble" />

      {/* humör */}
      <div className={`t-mood ${entered && !inGame ? "on" : ""}`}>
        <div className="t-meter"><span>♥</span><i><b style={{ width: `${mood.love}%` }} /></i></div>
        <div className="t-meter milk"><span>🥛</span><i><b style={{ width: `${mood.milk}%` }} /></i></div>
      </div>

      {/* mcap */}
      {ms.length > 0 && (
        <div className={`t-mcap ${entered && !inGame ? "on" : ""}`}>
          <small>{mcap?.mcap != null && !mcap.preview ? `mcap ${fmt(mcap.mcap)}` : mcap?.preview ? "preview" : `${site.name.toLowerCase()} grows with the mcap`}</small>
          <b>{mcap && mcap.idx >= 0 ? mcap.label : ms[0] ? `next: ${ms[0].label}` : ""}</b>
          <div className="t-steps">{ms.map((m, i) => <i key={m.at} className={mcap && i <= mcap.idx ? "on" : ""} title={`${m.label} · ${fmt(m.at)}`} />)}</div>
          {mcap?.next && mcap.idx >= 0 && <em>next: {mcap.next}</em>}
          {(!site.ca || mcap?.preview) && <button onClick={() => { sfx("click"); eng.current?.previewMcap(); }}>preview ▶</button>}
        </div>
      )}

      {/* knappar */}
      <div className={`t-actions ${entered && !inGame ? "on" : ""}`}>
        <button onClick={() => act("pet")}><span>🤚</span>{A.pet}</button>
        <button onClick={() => act("feed")}><span>🥛</span>{A.feed}</button>
        <button onClick={() => act("toy")}><span>🧶</span>{A.toy}</button>
        <button onClick={() => act("bonk")}><span>🔨</span>{A.bonk}</button>
        <button className="play" onClick={() => { sfx("click"); eng.current?.startGame(); }}><span>🕹️</span>{A.play}</button>
      </div>

      {/* arkad */}
      {inGame && (
        <div className="t-game">
          <div className="t-score"><span>{T.game.title}</span><b>{game.score}</b><em>{"♥".repeat(Math.max(0, game.lives))}<s>{"♥".repeat(Math.max(0, 3 - game.lives))}</s></em><small>best {game.best}</small></div>
          <button className="t-exit" onClick={() => { sfx("click"); eng.current?.exitGame(); }}>✕</button>
          {game.mode === "ready" && <div className="t-big">ready?</div>}
          {game.mode === "over" && (
            <div className="t-over">
              <h3>game over</h3>
              <p>score <b>{game.score}</b> · best <b>{game.best}</b></p>
              <div>
                <button onClick={() => { sfx("click"); eng.current?.startGame(); }}>play again</button>
                <button className="ghost" onClick={() => { sfx("click"); eng.current?.exitGame(); }}>back</button>
              </div>
            </div>
          )}
          {game.mode === "play" && game.score === 0 && <div className="t-tip">move with ← → or the mouse · catch the good stuff · dodge red candles</div>}
        </div>
      )}
    </>
  );
});
export default ToyView;
