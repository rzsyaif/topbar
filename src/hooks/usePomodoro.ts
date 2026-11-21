import { useCallback, useEffect, useRef, useState } from "react";
import type { PomodoroSettings } from "./useSettings";

export type PomodoroMode = "focus" | "break";

type State = {
  mode: PomodoroMode;
  running: boolean;
  /** When running: the timestamp it ends. When paused: ms left. */
  endsAt: number;
  remainingMs: number;
  /** Length of the current session (for the progress ring). */
  totalMs: number;
  /** Set for a few seconds after a session ends, to flash the pill. */
  finishedAt: number | null;
};

const lengthOf = (mode: PomodoroMode, s: PomodoroSettings) =>
  (mode === "focus" ? s.focusMinutes : s.breakMinutes) * 60_000;

export function usePomodoro(now: number, settings: PomodoroSettings) {
  const cfg = useRef(settings);
  cfg.current = settings;
  const len = (mode: PomodoroMode) => lengthOf(mode, cfg.current);

  const [s, setS] = useState<State>(() => {
    const total = lengthOf("focus", settings);
    return { mode: "focus", running: false, endsAt: 0, remainingMs: total, totalMs: total, finishedAt: null };
  });

  // New lengths apply right away to a timer that hasn't started yet; a session
  // that's running or paused part-way keeps its length until it ends.
  useEffect(() => {
    setS((p) => {
      const total = lengthOf(p.mode, settings);
      const untouched = !p.running && p.remainingMs === p.totalMs;
      return untouched && total !== p.totalMs ? { ...p, remainingMs: total, totalMs: total } : p;
    });
  }, [settings.focusMinutes, settings.breakMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const remainingMs = s.running ? Math.max(0, s.endsAt - now) : s.remainingMs;

  // Session finished: switch mode, stay paused, flag it for the alert.
  useEffect(() => {
    if (s.running && remainingMs === 0) {
      const mode: PomodoroMode = s.mode === "focus" ? "break" : "focus";
      const total = len(mode);
      setS({ mode, running: false, endsAt: 0, remainingMs: total, totalMs: total, finishedAt: Date.now() });
    }
  }, [s.running, s.mode, remainingMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback(
    () => setS((p) => (p.running ? p : { ...p, running: true, endsAt: Date.now() + p.remainingMs, finishedAt: null })),
    [],
  );
  const pause = useCallback(
    () => setS((p) => (p.running ? { ...p, running: false, remainingMs: Math.max(0, p.endsAt - Date.now()) } : p)),
    [],
  );
  const reset = useCallback(
    () =>
      setS((p) => {
        const total = len(p.mode);
        return { ...p, running: false, endsAt: 0, remainingMs: total, totalMs: total, finishedAt: null };
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const skip = useCallback(
    () =>
      setS((p) => {
        const mode: PomodoroMode = p.mode === "focus" ? "break" : "focus";
        const total = len(mode);
        return { mode, running: false, endsAt: 0, remainingMs: total, totalMs: total, finishedAt: null };
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const justFinished = s.finishedAt !== null && now - s.finishedAt < 15_000;
  const progress = s.totalMs ? 1 - remainingMs / s.totalMs : 0;

  return { mode: s.mode, running: s.running, remainingMs, progress, justFinished, start, pause, reset, skip };
}
