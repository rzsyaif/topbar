import { useEffect, useState } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import { config } from "../config";
import type { Place } from "./useLocation";

export type Weather = { tempC: number; code: number; label: string; isDay: boolean };

// WMO weather interpretation codes, as used by Open-Meteo.
const LABELS: [number[], string][] = [
  [[0], "Clear"],
  [[1, 2], "Partly cloudy"],
  [[3], "Cloudy"],
  [[45, 48], "Fog"],
  [[51, 53, 55, 56, 57], "Drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "Rain"],
  [[71, 73, 75, 77, 85, 86], "Snow"],
  [[95, 96, 99], "Thunderstorm"],
];

export const weatherLabel = (code: number) =>
  LABELS.find(([codes]) => codes.includes(code))?.[1] ?? "—";

export function useWeather(place: Place) {
  const lat = Math.round(place.latitude * 100) / 100;
  const lng = Math.round(place.longitude * 100) / 100;
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&current=temperature_2m,weather_code,is_day&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const c = data.current;
        if (alive)
          setWeather({
            tempC: Math.round(c.temperature_2m),
            code: c.weather_code,
            label: weatherLabel(c.weather_code),
            isDay: c.is_day === 1,
          });
      } catch {
        /* offline: keep the last reading */
      }
    };
    load();
    const id = setInterval(load, config.weather.refreshMinutes * 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [lat, lng]);

  return weather;
}
