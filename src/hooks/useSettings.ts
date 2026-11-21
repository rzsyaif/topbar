import { useCallback, useEffect, useState } from "react";
import { config } from "../config";
import { load, save } from "../lib/storage";
import type { MethodId } from "../lib/prayerMethods";

export type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

export type PrayerSettings = {
  /** Calculation method (see lib/prayerMethods). */
  method: MethodId;
  /** Asr time: Shafi'i / Maliki / Hanbali ("shafi") or Hanafi. */
  madhab: "shafi" | "hanafi";
  /** Reminder + countdown starts this many minutes before each prayer. */
  leadMinutes: number;
  /** ...and this many before Jumu'ah (Friday Dhuhr). */
  jumuahLeadMinutes: number;
  /** Windows notification when a reminder starts. */
  notify: boolean;
  /** Your own per-prayer correction in minutes, e.g. to match your mosque. */
  adjustments: Record<PrayerKey, number>;
};

export type City = { name: string; country: string; countryCode: string; latitude: number; longitude: number };
export type LocationSettings = { mode: "auto" | "manual"; city: City | null };

export type GeneralSettings = {
  use24h: boolean;
  /** Keep the island out of screenshots and recordings. */
  hideFromCapture: boolean;
  /** Blurred, glassy background (Windows acrylic). */
  glass: boolean;
  /** Content leans slightly toward the cursor. */
  tilt: boolean;
};

export type PomodoroSettings = { focusMinutes: number; breakMinutes: number };

/** Hydration and standing reminders. Separate from the focus timer. */
export type WellnessSettings = {
  waterOn: boolean;
  /** Minutes between water reminders. */
  waterEvery: number;
  /** Glasses a day. */
  waterGoal: number;
  standOn: boolean;
  /** Minutes between stand-up reminders. */
  standEvery: number;
  /** Reminders only between these hours (24h clock). */
  fromHour: number;
  toHour: number;
  /** Also send a Windows notification. */
  notify: boolean;
};

export type Settings = {
  prayer: PrayerSettings;
  pomodoro: PomodoroSettings;
  location: LocationSettings;
  general: GeneralSettings;
  wellness: WellnessSettings;
};

/** Defaults come from config.ts; anything changed in the island is saved on this PC. */
export const DEFAULTS: Settings = {
  prayer: {
    method: "kemenag",
    madhab: "shafi",
    leadMinutes: config.prayer.alertMinutesBefore,
    jumuahLeadMinutes: config.prayer.jumuahMinutesBefore,
    notify: config.prayer.notify,
    adjustments: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
  },
  pomodoro: { focusMinutes: config.pomodoro.focusMinutes, breakMinutes: config.pomodoro.breakMinutes },
  location: { mode: "auto", city: null },
  general: { use24h: config.use24h, hideFromCapture: config.hideFromScreenCapture, glass: true, tilt: true },
  wellness: { waterOn: true, waterEvery: 45, waterGoal: 8, standOn: true, standEvery: 60, fromHour: 8, toHour: 22, notify: false },
};

const KEY = "island.settings";
const ONBOARDED_KEY = "island.onboarded";

function loadSettings(): Settings {
  const s = load<Partial<Settings> & { prayer?: Partial<PrayerSettings> }>(KEY, {});
  const prayer = { ...DEFAULTS.prayer, ...s.prayer, adjustments: { ...DEFAULTS.prayer.adjustments, ...s.prayer?.adjustments } };
  // 0.3 had no method setting and baked Kemenag's +2 into the adjustments.
  // The method now adds it, so take it back out of saved adjustments.
  if (s.prayer && !s.prayer.method) {
    prayer.method = "kemenag";
    for (const k of Object.keys(prayer.adjustments) as PrayerKey[]) prayer.adjustments[k] -= 2;
  }
  return {
    prayer,
    pomodoro: { ...DEFAULTS.pomodoro, ...s.pomodoro },
    location: { ...DEFAULTS.location, ...s.location },
    general: { ...DEFAULTS.general, ...s.general },
    wellness: { ...DEFAULTS.wellness, ...s.wellness },
  };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // Existing users (who already have saved data) skip the welcome screen.
  const [onboarded, setOnboarded] = useState<boolean>(() => load<boolean>(ONBOARDED_KEY, false) || localStorage.getItem(KEY) !== null);
  useEffect(() => save(KEY, settings), [settings]);
  useEffect(() => save(ONBOARDED_KEY, onboarded), [onboarded]);

  const setPrayer = useCallback(
    (patch: Partial<PrayerSettings>) => setSettings((s) => ({ ...s, prayer: { ...s.prayer, ...patch } })),
    [],
  );
  const setPomodoro = useCallback(
    (patch: Partial<PomodoroSettings>) => setSettings((s) => ({ ...s, pomodoro: { ...s.pomodoro, ...patch } })),
    [],
  );
  const setLocation = useCallback(
    (patch: Partial<LocationSettings>) => setSettings((s) => ({ ...s, location: { ...s.location, ...patch } })),
    [],
  );
  const setGeneral = useCallback(
    (patch: Partial<GeneralSettings>) => setSettings((s) => ({ ...s, general: { ...s.general, ...patch } })),
    [],
  );
  const setWellness = useCallback(
    (patch: Partial<WellnessSettings>) => setSettings((s) => ({ ...s, wellness: { ...s.wellness, ...patch } })),
    [],
  );
  const resetWellness = useCallback(() => setSettings((s) => ({ ...s, wellness: DEFAULTS.wellness })), []);
  const resetPrayer = useCallback(
    () => setSettings((s) => ({ ...s, prayer: { ...DEFAULTS.prayer, method: s.prayer.method, madhab: s.prayer.madhab } })),
    [],
  );
  const resetPomodoro = useCallback(() => setSettings((s) => ({ ...s, pomodoro: DEFAULTS.pomodoro })), []);

  return {
    settings,
    onboarded,
    setOnboarded,
    setPrayer,
    setPomodoro,
    setLocation,
    setGeneral,
    setWellness,
    resetWellness,
    resetPrayer,
    resetPomodoro,
  };
}
