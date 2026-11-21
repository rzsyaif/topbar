import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Sample = { hex: string; pixels: number[] };
const GRID = 11;
const CELL = 11; // px per magnified pixel
const SIZE = GRID * CELL;

/**
 * Runs in its own full-screen, see-through window. A magnifier follows the
 * cursor; click to copy the colour under it, Esc to cancel.
 */
export function Picker() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  const frame = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add("picker-page");
    const done = (hex: string | null) => invoke("picker_done", { hex }).catch(() => window.close());
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && done(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Draw the magnified grid whenever a new sample arrives.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !sample) return;
    const ctx = c.getContext("2d")!;
    const p = sample.pixels;
    for (let i = 0; i < GRID * GRID; i++) {
      ctx.fillStyle = `rgb(${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]})`;
      ctx.fillRect((i % GRID) * CELL, Math.floor(i / GRID) * CELL, CELL, CELL);
    }
    // Faint grid lines, and a crisp box around the centre pixel.
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    for (let k = 1; k < GRID; k++) {
      ctx.beginPath();
      ctx.moveTo(k * CELL + 0.5, 0);
      ctx.lineTo(k * CELL + 0.5, SIZE);
      ctx.moveTo(0, k * CELL + 0.5);
      ctx.lineTo(SIZE, k * CELL + 0.5);
      ctx.stroke();
    }
    const m = Math.floor(GRID / 2) * CELL;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 3;
    ctx.strokeRect(m - 0.5, m - 0.5, CELL + 1, CELL + 1);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(m - 0.5, m - 0.5, CELL + 1, CELL + 1);
  }, [sample]);

  const onMove = (e: React.PointerEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        setSample(await invoke<Sample>("picker_sample"));
      } catch {
        /* ignore a missed frame */
      }
      busy.current = false;
    });
  };

  const pick = async () => {
    let s = sample;
    try {
      s = await invoke<Sample>("picker_sample");
    } catch {
      /* use the last sample */
    }
    invoke("picker_done", { hex: s?.hex ?? null }).catch(() => window.close());
  };

  // Keep the loupe on screen near edges.
  const W = typeof window !== "undefined" ? window.innerWidth : 0;
  const H = typeof window !== "undefined" ? window.innerHeight : 0;
  const lx = pos ? (pos.x + 24 + SIZE + 16 > W ? pos.x - 24 - SIZE - 16 : pos.x + 24) : 0;
  const ly = pos ? (pos.y + 24 + SIZE + 60 > H ? pos.y - 24 - SIZE - 60 : pos.y + 24) : 0;

  return (
    <div className="picker" onPointerMove={onMove} onPointerDown={(e) => e.button === 0 && pick()}>
      {!pos && <div className="picker-hint">Move to a colour · click to copy · Esc to cancel</div>}
      {pos && (
        <div className="loupe" style={{ left: lx, top: ly }}>
          <canvas ref={canvasRef} width={SIZE} height={SIZE} className="loupe-canvas" />
          <div className="loupe-foot">
            <span className="loupe-swatch" style={{ background: sample?.hex ?? "transparent" }} />
            <span className="loupe-hex">{sample?.hex ?? "…"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
