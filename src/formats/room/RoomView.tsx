import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { FormatHandle, FormatProps } from "../types";
import { Engine } from "./RoomEngine";

/** Format "room": utforskbart diorama-rum (babacoin-stil). */
const RoomView = forwardRef<FormatHandle, FormatProps>(function RoomView({ site, onProgress, onOpen, sfx }, ref) {
  const stage = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const eng = useRef<Engine | null>(null);

  useEffect(() => {
    const e = new Engine(stage.current!, site, { label: label.current!, bubble: bubble.current! }, { onProgress, onOpen, onSfx: sfx });
    eng.current = e; e.load();
    return () => e.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    enter: () => eng.current?.enter(),
    open: (t) => eng.current?.open(t),
    closePanel: () => eng.current?.closePanel(),
  }), []);

  return (
    <>
      <div ref={stage} className="stage" />
      <div ref={label} className="hover-label" />
      <div ref={bubble} className="bubble" />
    </>
  );
});
export default RoomView;
