import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Tells the Rust side where the pill is, so clicks outside it pass through to
 * the apps underneath. Re-sends whenever the pill changes size (including
 * every frame of its expand/collapse animation).
 */
export function useHitRect(ref: RefObject<HTMLElement>, wholeWindow = false) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const send = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = wholeWindow
          ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
          : el.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        invoke("set_hit_rect", {
          rect: { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr },
        }).catch(() => {});
      });
    };
    const ro = new ResizeObserver(send);
    ro.observe(el);
    window.addEventListener("resize", send);
    send();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", send);
      cancelAnimationFrame(frame);
    };
  }, [ref, wholeWindow]);
}
