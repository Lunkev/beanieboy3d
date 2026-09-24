import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { OpenTarget } from "../../types";
import type { FormatHandle, FormatProps } from "../types";
import { WorldEngine } from "./WorldEngine";
import "./world.css";

/** Format "world": liten ö där karaktären går omkring. Skalets HUD/docka/panel används. */
const WorldView = forwardRef<FormatHandle, FormatProps>(function WorldView({ site, onProgress, onOpen, sfx }, ref) {
  const stage = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const pins = useRef<HTMLDivElement>(null);
  const mm = useRef<HTMLCanvasElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const eng = useRef<WorldEngine | null>(null);
  const [near, setNear] = useState<{ label: string; open: OpenTarget } | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const e = new WorldEngine(stage.current!, site, { bubble: bubble.current!, pins: pins.current!, minimap: mm.current!, marker: marker.current! }, {
      onProgress, onSfx: sfx, onNear: setNear,
      onOpen: (t) => { setNear(null); onOpen(t); },
    });
    eng.current = e; e.load();
    return () => e.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    enter: () => { setEntered(true); eng.current?.enter(); },
    open: (t) => eng.current?.open(t),
    closePanel: () => eng.current?.closePanel(),
  }), []);

  return (
    <>
      <div ref={stage} className="stage w-stage" />
      <div ref={pins} className={`w-pins ${entered ? "on" : ""}`} />
      <div ref={marker} className="w-marker" />
      <div ref={bubble} className="bubble" />
      <canvas ref={mm} className={`w-minimap ${entered ? "on" : ""}`} width={240} height={240} title="map" />
      <button className={`w-prompt ${near ? "on" : ""}`} onClick={() => { sfx("click"); eng.current?.openNear(); }}>
        <kbd>E</kbd> {near ? (near.open.startsWith("link:") ? near.label : `open ${near.label}`) : ""}
      </button>
      <div className={`w-keys ${entered ? "on" : ""}`}><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · click to go · drag to turn</div>
    </>
  );
});
export default WorldView;
