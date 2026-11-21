import { config } from "../config";

let use24h = config.use24h;
/** Set from the island's settings. */
export const setUse24h = (v: boolean) => {
  use24h = v;
};

export const clock = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !use24h });

export const mmss = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** "in 1h 20m" / "in 12m" / "now" */
export const until = (ms: number) => {
  const m = Math.ceil(ms / 60_000);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m}m`;
  return `in ${Math.floor(m / 60)}h ${m % 60}m`;
};
