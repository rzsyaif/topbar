import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; at: number }
  | { kind: "available"; version: string; notes?: string; at: number }
  | { kind: "installing"; progress: number | null }
  | { kind: "off" } // not set up in this build (no signing key yet)
  | { kind: "error"; message: string };

const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 6 * 60 * 60_000;

/**
 * Checks GitHub Releases for a newer Island: 30s after start, then every 6
 * hours. Installing downloads the signed installer, runs it quietly and
 * restarts the island.
 */
export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const update = useRef<Update | null>(null);
  const busy = useRef(false);

  const runCheck = useCallback(async (manual = false) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) setStatus({ kind: "checking" });
    try {
      const u = await check();
      update.current = u;
      setStatus(u ? { kind: "available", version: u.version, notes: u.body, at: Date.now() } : { kind: "latest", at: Date.now() });
    } catch (e) {
      const msg = String(e);
      // The updater only runs in builds that have a public key configured.
      if (/not found|not allowed|plugin/i.test(msg)) setStatus({ kind: "off" });
      else if (manual) setStatus({ kind: "error", message: "Couldn't reach GitHub. Try again later." });
      else setStatus((s) => (s.kind === "checking" ? { kind: "idle" } : s));
      console.warn("update check:", e);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => runCheck(), FIRST_CHECK_MS);
    const id = window.setInterval(() => runCheck(), EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [runCheck]);

  const install = useCallback(async () => {
    const u = update.current;
    if (!u || busy.current) return;
    busy.current = true;
    let total = 0;
    let got = 0;
    setStatus({ kind: "installing", progress: null });
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          setStatus({ kind: "installing", progress: total ? got / total : null });
        }
      });
      await relaunch();
    } catch (e) {
      console.warn("update install:", e);
      setStatus({ kind: "error", message: "The update didn't install. Try again later." });
    } finally {
      busy.current = false;
    }
  }, []);

  return { status, check: () => runCheck(true), install };
}
