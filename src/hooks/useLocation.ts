import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { config } from "../config";
import type { LocationSettings } from "./useSettings";

export type Place = {
  latitude: number;
  longitude: number;
  name: string;
  /** ISO country code, when known (used to suggest a prayer method). */
  countryCode?: string;
  /** "device" = live Windows location, "saved" = last known, "manual" = a city you chose, "fallback" = config.ts */
  source: "device" | "saved" | "manual" | "fallback";
};

const STORAGE_KEY = "island.lastLocation";

function loadSaved(): Place | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...(JSON.parse(raw) as Place), source: "saved" } : null;
  } catch {
    return null;
  }
}

function save(p: Place) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: fine, we just re-locate next launch */
  }
}

/** City name + country for coordinates (free, no key). */
async function placeName(lat: number, lng: number): Promise<{ name: string | null; countryCode?: string }> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    );
    if (!res.ok) return { name: null };
    const d = await res.json();
    return { name: d.city || d.locality || d.principalSubdivision || null, countryCode: d.countryCode || undefined };
  } catch {
    return { name: null };
  }
}

/** Asks Windows for the device location once. Throws if location is off. */
export async function locateOnce(): Promise<Place> {
  const { latitude, longitude } = await invoke<{ latitude: number; longitude: number }>("get_location");
  const { name, countryCode } = await placeName(latitude, longitude);
  const next: Place = { latitude, longitude, name: name ?? "Current location", countryCode, source: "device" };
  save(next);
  return next;
}

export type CityResult = { name: string; country: string; countryCode: string; admin?: string; latitude: number; longitude: number };

/** City search (Open-Meteo geocoding: free, no key). */
export async function searchCities(q: string): Promise<CityResult[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=6&language=en&format=json`);
  if (!res.ok) return [];
  const d = await res.json();
  return (d.results ?? []).map((r: Record<string, unknown>) => ({
    name: String(r.name),
    country: String(r.country ?? ""),
    countryCode: String(r.country_code ?? ""),
    admin: r.admin1 ? String(r.admin1) : undefined,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
  }));
}

const fallback: Place = { ...config.fallbackLocation, source: "fallback" };

/**
 * Where weather and prayer times are for: either the device location (Windows
 * location service, refreshed periodically) or a city you picked. Starts from
 * the last known place (or config.ts) so things show immediately.
 */
export function useLocation(settings: LocationSettings) {
  const manual = settings.mode === "manual" && settings.city;
  const [auto, setAuto] = useState<Place>(() => loadSaved() ?? fallback);

  useEffect(() => {
    if (manual) return;
    let alive = true;
    const locate = () =>
      locateOnce()
        .then((p) => alive && setAuto(p))
        .catch((e) => console.warn("location unavailable, using last known/fallback:", e));
    locate();
    const id = setInterval(locate, config.locationRefreshMinutes * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [manual]);

  if (manual && settings.city) {
    const c = settings.city;
    return { latitude: c.latitude, longitude: c.longitude, name: c.name, countryCode: c.countryCode, source: "manual" } as Place;
  }
  return auto;
}
