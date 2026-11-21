import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { load, save } from "../lib/storage";
import type { WellnessSettings } from "./useSettings";

export type WellKind = "water" | "stand";

type Track = { count: number; last: number | null; nextAt: number };
type Stored = { day: string; water: Track; stand: Track; pending: Partial<Record<WellKind, number>> };

const KEY = "island.wellness";
const MIN = 60_000;
/** "Later" pushes a reminder back this long. */
export const SNOOZE_MIN = 10;
/** A reminder nobody reacts to snoozes itself after this long on screen. */
const SHOW_MS = 2 * MIN;
/** Away from the keyboard this long counts as having stood up. */
const AWAY_MS = 5 * MIN;
/** Only remind someone who touched the keyboard or mouse in the last minute. */
const PRESENT_MS = 1 * MIN;
const POLL_MS = 10_000;

const dayKey = (t: number) => new Date(t).toDateString();

function fresh(now: number, s: WellnessSettings): Stored {
  return {
    day: dayKey(now),
    water: { count: 0, last: null, nextAt: now + s.waterEvery * MIN },
    stand: { count: 0, last: null, nextAt: now + s.standEvery * MIN },
    pending: {},
  };
}

/** Minutes since midnight. */
const minuteOfDay = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};
export function inActiveHours(t: number, s: WellnessSettings) {
  const m = minuteOfDay(t);
  const from = s.fromHour * 60;
  const to = s.toHour * 60;
  return from <= to ? m >= from && m < to : m >= from || m < to; // allows overnight ranges
}

async function notify(title: string, body: string) {
  try {
    if (!(await isPermissionGranted()) && (await requestPermission()) !== "granted") return;
    sendNotification({ title, body });
  } catch {
    /* notifications are a bonus */
  }
}

/**
 * Hydration and standing reminders, each on its own timer.
 *
 * - Outside your active hours, nothing fires (the first reminder of the day
 *   comes one interval after the start time).
 * - Away from the keyboard for 5+ minutes counts as having stood up.
 * - Nothing fires while you're away, in a full-screen game or presentation,
 *   or while a prayer reminder is showing. A due reminder waits for you.
 * - A reminder you don't react to snoozes itself for 10 minutes.
 */
export function useWellness(now: number, s: WellnessSettings, prayerAlert: boolean) {
  const [state, setState] = useState<Stored>(() => {
    const saved = load<Stored | null>(KEY, null);
    const t = Date.now();
    if (!saved || saved.day !== dayKey(t)) return fresh(t, s);
    // Coming back from a restart: never fire the instant the app opens.
    const floor = t + 2 * MIN;
    return {
      ...saved,
      pending: {},
      water: { ...saved.water, nextAt: Math.max(saved.water.nextAt, floor) },
      stand: { ...saved.stand, nextAt: Math.max(saved.stand.nextAt, floor) },
    };
  });
  useEffect(() => save(KEY, state), [state]);

  const [activity, setActivity] = useState({ idleMs: 0, busy: false });
  useEffect(() => {
    let alive = true;
    const poll = () =>
      invoke<{ idle_ms: number; busy: boolean }>("activity")
        .then((a) => alive && setActivity({ idleMs: a.idle_ms, busy: a.busy }))
        .catch(() => {});
    poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const settingsRef = useRef(s);
  settingsRef.current = s;
  /** When each pending reminder first became visible, for the auto-snooze. */
  const shownAt = useRef<Partial<Record<WellKind, number>>>({});

  // The scheduler. Runs on every tick of `now`, but only changes state when
  // something actually has to happen.
  useEffect(() => {
    const st = state;
    // New day: counts start again.
    if (st.day !== dayKey(now)) {
      setState(fresh(now, s));
      return;
    }
    const active = inActiveHours(now, s);
    const away = activity.idleMs >= AWAY_MS;
    const present = activity.idleMs < PRESENT_MS;
    const quiet = activity.busy || prayerAlert;
    let next = st;
    const patch = (k: WellKind, t: Partial<Track>) => {
      next = { ...next, [k]: { ...next[k], ...t } };
    };

    for (const k of ["water", "stand"] as WellKind[]) {
      const on = k === "water" ? s.waterOn : s.standOn;
      const every = (k === "water" ? s.waterEvery : s.standEvery) * MIN;
      const pending = next.pending[k];

      if (!on) {
        if (pending) next = { ...next, pending: { ...next.pending, [k]: undefined } };
        continue;
      }
      // Outside active hours the clock just keeps getting pushed back.
      if (!active) {
        if (pending) next = { ...next, pending: { ...next.pending, [k]: undefined } };
        if (next[k].nextAt < now + every) patch(k, { nextAt: now + every });
        continue;
      }
      // Walked away from the desk: that's a stand. Restart its timer.
      if (k === "stand" && away) {
        if (pending) next = { ...next, pending: { ...next.pending, stand: undefined } };
        if (next.stand.nextAt < now + every) patch("stand", { nextAt: now + every });
        continue;
      }
      if (pending) {
        // Visible on screen long enough without a reaction → snooze.
        if (present && !quiet) {
          shownAt.current[k] ??= now;
          if (now - shownAt.current[k]! >= SHOW_MS) {
            delete shownAt.current[k];
            next = { ...next, pending: { ...next.pending, [k]: undefined } };
            patch(k, { nextAt: now + SNOOZE_MIN * MIN });
          }
        }
        continue;
      }
      if (now >= next[k].nextAt && present && !quiet) {
        next = { ...next, pending: { ...next.pending, [k]: now } };
        delete shownAt.current[k];
        if (s.notify) {
          const both = next.pending.water && next.pending.stand;
          notify(
            both ? "Stand up and drink some water" : k === "water" ? "Time for some water" : "Time to stand up",
            k === "water" ? `Glass ${next.water.count + 1} of ${s.waterGoal} today.` : "Stretch for a minute and rest your eyes.",
          );
        }
      }
    }
    if (next !== st) setState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, activity, prayerAlert, s]);

  /** Logged a glass / stood up (whether or not it was reminded). */
  const done = useCallback((k: WellKind) => {
    const t = Date.now();
    delete shownAt.current[k];
    const every = (k === "water" ? settingsRef.current.waterEvery : settingsRef.current.standEvery) * MIN;
    setState((st) => ({
      ...st,
      [k]: { count: st[k].count + 1, last: t, nextAt: t + every },
      pending: { ...st.pending, [k]: undefined },
    }));
  }, []);

  /** Remind again in a few minutes. */
  const later = useCallback((k: WellKind) => {
    const t = Date.now();
    delete shownAt.current[k];
    setState((st) => ({
      ...st,
      [k]: { ...st[k], nextAt: t + SNOOZE_MIN * MIN },
      pending: { ...st.pending, [k]: undefined },
    }));
  }, []);

  /** Undo the last glass (a mis-tap). */
  const undoWater = useCallback(() => {
    setState((st) => ({ ...st, water: { ...st.water, count: Math.max(0, st.water.count - 1) } }));
  }, []);

  // When the interval setting changes, re-plan from the last time it was done.
  const prevEvery = useRef({ w: s.waterEvery, s: s.standEvery });
  useEffect(() => {
    const p = prevEvery.current;
    if (p.w === s.waterEvery && p.s === s.standEvery) return;
    prevEvery.current = { w: s.waterEvery, s: s.standEvery };
    const t = Date.now();
    setState((st) => ({
      ...st,
      water: { ...st.water, nextAt: Math.max(t + MIN, (st.water.last ?? t) + s.waterEvery * MIN) },
      stand: { ...st.stand, nextAt: Math.max(t + MIN, (st.stand.last ?? t) + s.standEvery * MIN) },
    }));
  }, [s.waterEvery, s.standEvery]);

  const pending = {
    water: !!state.pending.water && s.waterOn,
    stand: !!state.pending.stand && s.standOn,
  };
  return {
    water: state.water,
    stand: state.stand,
    pending,
    /** Show the reminder in the collapsed island right now. */
    showing: (pending.water || pending.stand) && !activity.busy && !prayerAlert,
    active: inActiveHours(now, s),
    done,
    later,
    undoWater,
  };
}
