import { useEffect, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Liquid-glass look, drawn in CSS (rim light, sheen, translucent gradients).
 * On start-up it also clears any native blur/clipping left by older builds.
 * Returns true when the glass styling should be used.
 */
export function useGlass(_wrapRef: RefObject<HTMLElement>, enabled: boolean) {
  useEffect(() => {
    invoke("set_glass", { enabled: false }).catch(() => {});
  }, []);
  return enabled;
}
