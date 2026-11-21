import { useEffect } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { clock } from "../lib/format";
import { load, save } from "../lib/storage";
import type { usePrayer } from "./usePrayer";

const KEY = "island.prayerReminders";

async function canNotify() {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/**
 * Sends one Windows notification when a prayer enters its reminder window
 * (5 min before, 30 min before Jumu'ah). Remembers what it already sent, so a
 * restart inside the window doesn't notify twice.
 */
export function usePrayerReminder(prayer: ReturnType<typeof usePrayer>, notify: boolean) {
  const a = prayer.alert;
  const key = a && a.kind === "soon" ? `${a.prayer.time.toDateString()}|${a.prayer.name}` : null;

  useEffect(() => {
    if (!key || !a || !notify) return;
    const sent = load<string[]>(KEY, []);
    if (sent.includes(key)) return;
    save(KEY, [...sent.slice(-20), key]);

    const p = a.prayer;
    const mins = Math.max(1, Math.ceil(prayer.msUntilNext / 60_000));
    const jumuah = p.label === "Jumu'ah";
    canNotify().then((ok) => {
      if (!ok) return;
      sendNotification({
        title: jumuah ? `Jumu'ah in ${mins} minutes` : `${p.label} in ${mins} minutes`,
        body: jumuah
          ? `Time to get ready for Friday prayer at ${clock(p.time)}.`
          : `${p.label} starts at ${clock(p.time)}.`,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
