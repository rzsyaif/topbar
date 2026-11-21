import { useMemo } from "react";
import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from "adhan";
import { methodById } from "../lib/prayerMethods";
import { config } from "../config";
import type { Place } from "./useLocation";
import type { PrayerSettings } from "./useSettings";

export type PrayerName = "Fajr" | "Dhuhr" | "Asr" | "Maghrib" | "Isha";
export type PrayerTime = {
  name: PrayerName;
  /** What to show: "Jumu'ah" for Dhuhr on Fridays. */
  label: string;
  time: Date;
  /** How early the reminder starts. */
  leadMinutes: number;
};

const isJumuah = (name: PrayerName, time: Date) => name === "Dhuhr" && time.getDay() === 5;

function timesFor(date: Date, lat: number, lng: number, s: PrayerSettings): PrayerTime[] {
  const coords = new Coordinates(lat, lng);
  const m = methodById(s.method);
  const params = CalculationMethod[m.base]();
  params.madhab = s.madhab === "hanafi" ? Madhab.Hanafi : Madhab.Shafi;
  // The method's own safety margin (Kemenag: +2) plus your adjustments.
  const extra = m.ihtiyat ?? 0;
  params.adjustments.fajr = s.adjustments.fajr + extra;
  params.adjustments.dhuhr = s.adjustments.dhuhr + extra;
  params.adjustments.asr = s.adjustments.asr + extra;
  params.adjustments.maghrib = s.adjustments.maghrib + extra;
  params.adjustments.isha = s.adjustments.isha + extra;
  const pt = new PrayerTimes(coords, date, params);
  const list: [PrayerName, Date][] = [
    ["Fajr", pt.fajr],
    ["Dhuhr", pt.dhuhr],
    ["Asr", pt.asr],
    ["Maghrib", pt.maghrib],
    ["Isha", pt.isha],
  ];
  return list.map(([name, time]) => {
    const jumuah = isJumuah(name, time);
    return {
      name,
      time,
      label: jumuah ? "Jumu'ah" : name,
      leadMinutes: jumuah ? s.jumuahLeadMinutes : s.leadMinutes,
    };
  });
}

/**
 * Prayer times are calculated on the device (no network). `now` should tick
 * at least once a minute.
 */
export function usePrayer(now: number, place: Place, settings: PrayerSettings) {
  // Recompute when any timing setting changes (not the notify toggle).
  const sKey = JSON.stringify([settings.method, settings.madhab, settings.leadMinutes, settings.jumuahLeadMinutes, settings.adjustments]);
  const day = new Date(now).toDateString();
  // Round so tiny GPS jitter doesn't recompute (0.01° ≈ 1 km ≈ well under a minute of prayer time).
  const lat = Math.round(place.latitude * 100) / 100;
  const lng = Math.round(place.longitude * 100) / 100;
  const today = useMemo(() => timesFor(new Date(now), lat, lng, settings), [day, lat, lng, sKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const tomorrow = useMemo(() => timesFor(new Date(now + 86_400_000), lat, lng, settings), [day, lat, lng, sKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = today.find((p) => p.time.getTime() > now) ?? tomorrow[0];
  const current = [...today].reverse().find((p) => p.time.getTime() <= now) ?? null;

  const msUntilNext = next.time.getTime() - now;
  const msSinceCurrent = current ? now - current.time.getTime() : Infinity;

  const { alertMinutesAfter } = config.prayer;
  const alert: { prayer: PrayerTime; kind: "soon" | "now" } | null =
    msUntilNext <= next.leadMinutes * 60_000
      ? { prayer: next, kind: "soon" }
      : msSinceCurrent <= alertMinutesAfter * 60_000 && current
        ? { prayer: current, kind: "now" }
        : null;

  return { today, next, msUntilNext, alert };
}
