import { useCallback, useEffect, useState } from "react";
import { load, save, uid } from "../lib/storage";

export type Note = {
  id: string;
  text: string;
  /** Top-left position on the board, in CSS px. */
  x: number;
  y: number;
  color: number;
  /** Resting tilt in degrees, for a hand-placed look. */
  rot: number;
  z: number;
};

/** Soft paper tones that sit well on the black island. */
export const NOTE_COLORS = ["#f1e1a2", "#f0c8a6", "#cadbb9", "#d2c9e8", "#acd4d6"];

const KEY = "island.notes";

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(() => load<Note[]>(KEY, []));
  useEffect(() => save(KEY, notes), [notes]);

  const topZ = () => notes.reduce((m, n) => Math.max(m, n.z), 0) + 1;

  /** Each new note takes the colour after the most recently placed one. */
  const nextColor = (() => {
    if (!notes.length) return 0;
    const latest = notes.reduce((a, b) => (b.z > a.z ? b : a));
    return (latest.color + 1) % NOTE_COLORS.length;
  })();

  const add = useCallback(
    (x: number, y: number) => {
      const note: Note = {
        id: uid(),
        text: "",
        x,
        y,
        color: nextColor,
        rot: Math.round((Math.random() * 6 - 3) * 10) / 10,
        z: topZ(),
      };
      setNotes((ns) => [...ns, note]);
      return note.id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notes],
  );

  const update = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const bringToFront = useCallback((id: string) => {
    setNotes((ns) => {
      const top = ns.reduce((m, n) => Math.max(m, n.z), 0);
      const n = ns.find((x) => x.id === id);
      if (!n || n.z === top) return ns;
      return ns.map((x) => (x.id === id ? { ...x, z: top + 1 } : x));
    });
  }, []);

  const remove = useCallback((id: string) => setNotes((ns) => ns.filter((n) => n.id !== id)), []);
  const clear = useCallback(() => setNotes([]), []);
  const restore = useCallback((list: Note[]) => setNotes(list), []);

  return { notes, nextColor, add, update, bringToFront, remove, clear, restore };
}
