import { useCallback, useEffect, useRef, useState } from "react";
import { load, save } from "../lib/storage";

/** The tasbih after salah: 33 · 33 · 34 = 100. */
export const PHASES = [
  { arabic: "سُبْحَانَ ٱللَّٰهِ", latin: "Subḥānallāh", target: 33 },
  { arabic: "ٱلْحَمْدُ لِلَّٰهِ", latin: "Alḥamdulillāh", target: 33 },
  { arabic: "ٱللَّٰهُ أَكْبَرُ", latin: "Allāhu akbar", target: 34 },
] as const;

type State = { mode: "tasbih" | "free"; phase: number; count: number; free: number; date: string; today: number };
const KEY = "island.tasbih";
const day = () => new Date().toLocaleDateString("en-CA");

export function useTasbih() {
  const [s, setS] = useState<State>(() => {
    const saved = load<State>(KEY, { mode: "tasbih", phase: 0, count: 0, free: 0, date: day(), today: 0 });
    return saved.date === day() ? saved : { ...saved, phase: 0, count: 0, free: 0, date: day(), today: 0 };
  });
  /** Bumps on each phase completion, so the view can play its milestone animation. */
  const [milestone, setMilestone] = useState<{ n: number; kind: "phase" | "done" } | null>(null);

  useEffect(() => save(KEY, s), [s]);

  // Each completed phase (and the whole 100) gets a little celebration.
  const prevPhase = useRef(s.phase);
  useEffect(() => {
    if (s.phase > prevPhase.current) {
      setMilestone({ n: Date.now(), kind: s.phase >= PHASES.length ? "done" : "phase" });
    }
    prevPhase.current = s.phase;
  }, [s.phase]);

  const done = s.mode === "tasbih" && s.phase >= PHASES.length;

  const tap = useCallback(() => {
    setS((p) => {
      if (p.mode === "free") return { ...p, free: p.free + 1, today: p.today + 1 };
      if (p.phase >= PHASES.length) return p;
      const count = p.count + 1;
      if (count >= PHASES[p.phase].target) {
        const phase = p.phase + 1;
        return { ...p, phase, count: phase >= PHASES.length ? count : 0, today: p.today + 1 };
      }
      return { ...p, count, today: p.today + 1 };
    });
  }, []);

  const reset = useCallback(() => setS((p) => ({ ...p, phase: 0, count: 0, free: 0 })), []);
  const setMode = useCallback((mode: State["mode"]) => setS((p) => ({ ...p, mode, phase: 0, count: 0, free: 0 })), []);

  return { ...s, done, tap, reset, setMode, milestone };
}
