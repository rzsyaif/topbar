import { useEffect, type RefObject } from "react";

/**
 * Subtle 3D: the island's content leans toward the cursor, and a soft light
 * on the glass follows it. Writes CSS variables directly (no re-renders).
 *   --rx / --ry  rotation of the content layer
 *   --mx / --my  cursor position for the specular sheen
 */
export function useTilt(pillRef: RefObject<HTMLElement>, enabled: boolean, maxDeg: number) {
  useEffect(() => {
    const el = pillRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const reset = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.style.setProperty("--sheen", "0");
    };
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
        el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
        el.style.setProperty("--sheen", "1");
        if (enabled && !reduce) {
          // Wide panels tilt less than the small pill, so the edges move about the same.
          el.style.setProperty("--ry", `${((px - 0.5) * 2 * maxDeg).toFixed(2)}deg`);
          el.style.setProperty("--rx", `${((0.5 - py) * 2 * maxDeg).toFixed(2)}deg`);
        } else {
          el.style.setProperty("--rx", "0deg");
          el.style.setProperty("--ry", "0deg");
        }
      });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", reset);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", reset);
      cancelAnimationFrame(frame);
    };
  }, [pillRef, enabled, maxDeg]);
}
