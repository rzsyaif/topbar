import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export type Hud =
  | { kind: "volume"; value: number; muted: boolean; at: number }
  | { kind: "brightness"; value: number; at: number };

/** Volume / brightness changes from the keyboard, for the collapsed island. */
export function useHud() {
  const [hud, setHud] = useState<Hud | null>(null);
  useEffect(() => {
    const a = listen<{ level: number; muted: boolean }>("volume-changed", (e) =>
      setHud({ kind: "volume", value: Math.round(e.payload.level * 100), muted: e.payload.muted, at: Date.now() }),
    );
    const b = listen<number>("brightness-changed", (e) => setHud({ kind: "brightness", value: e.payload, at: Date.now() }));
    return () => {
      a.then((f) => f());
      b.then((f) => f());
    };
  }, []);
  return hud;
}
