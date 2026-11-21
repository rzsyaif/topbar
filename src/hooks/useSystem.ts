import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type RadioKind = "wifi" | "bluetooth";
export type Radios = { wifi: boolean | null; bluetooth: boolean | null };
export type Volume = { level: number; muted: boolean };
export type WifiNetwork = { ssid: string; bars: number; secured: boolean; connected: boolean };
export type BtDevice = { name: string; connected: boolean };

const POLL_MS = 1500;
const BRIGHTNESS_POLL_MS = 15_000;
/** After you change something, ignore polled values for a moment so the UI doesn't jump back. */
const QUIET_MS = 1500;

/**
 * Sends values one at a time and drops stale ones: while a call is running,
 * only the newest value waits. Keeps dragging smooth even when the system call
 * is slow (brightness through WMI takes a few hundred ms).
 */
function coalesced<T>(send: (v: T) => Promise<unknown>) {
  let inFlight = false;
  let pending: { v: T } | null = null;
  const run = async (v: T) => {
    inFlight = true;
    try {
      await send(v);
    } catch (e) {
      console.warn(e);
    }
    inFlight = false;
    if (pending) {
      const next = pending.v;
      pending = null;
      run(next);
    }
  };
  return (v: T) => {
    if (inFlight) pending = { v };
    else run(v);
  };
}

/** Polls system state only while `active` (the Now tab is open). */
export function useSystem(active: boolean) {
  const [radios, setRadios] = useState<Radios>({ wifi: null, bluetooth: null });
  const [busy, setBusy] = useState<Record<RadioKind, boolean>>({ wifi: false, bluetooth: false });
  const [volume, setVolumeState] = useState<Volume | null>(null);
  /** undefined = not loaded yet, null = not adjustable on this display */
  const [brightness, setBrightnessState] = useState<number | null | undefined>(undefined);
  const touched = useRef({ volume: 0, brightness: 0, radios: 0 });

  const sendVolume = useRef(coalesced((level: number) => invoke("volume_set", { level }))).current;
  const sendBrightness = useRef(coalesced((value: number) => invoke("brightness_set", { value }))).current;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const poll = async () => {
      const quiet = (k: keyof typeof touched.current) => Date.now() - touched.current[k] < QUIET_MS;
      const [r, v] = await Promise.allSettled([invoke<Radios>("radios_get"), invoke<Volume>("volume_get")]);
      if (!alive) return;
      if (r.status === "fulfilled" && !quiet("radios")) setRadios(r.value);
      if (v.status === "fulfilled" && !quiet("volume")) setVolumeState(v.value);
    };
    const pollBrightness = async () => {
      if (Date.now() - touched.current.brightness < QUIET_MS * 3) return;
      try {
        const b = await invoke<number | null>("brightness_get");
        if (alive) setBrightnessState(b);
      } catch {
        if (alive) setBrightnessState(null);
      }
    };
    poll();
    pollBrightness();
    const a = setInterval(poll, POLL_MS);
    const b = setInterval(pollBrightness, BRIGHTNESS_POLL_MS);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, [active]);

  const toggleRadio = useCallback(
    async (kind: RadioKind) => {
      const current = radios[kind];
      if (current === null || busy[kind]) return;
      touched.current.radios = Date.now();
      setBusy((b) => ({ ...b, [kind]: true }));
      try {
        const on = await invoke<boolean>("radio_set", { kind, on: !current });
        setRadios((r) => ({ ...r, [kind]: on }));
      } catch (e) {
        console.warn("radio_set", e);
      } finally {
        touched.current.radios = Date.now();
        setBusy((b) => ({ ...b, [kind]: false }));
      }
    },
    [radios, busy],
  );

  const setVolume = useCallback(
    (level: number) => {
      const l = Math.min(1, Math.max(0, level));
      touched.current.volume = Date.now();
      setVolumeState((v) => ({ level: l, muted: l > 0 ? false : (v?.muted ?? false) }));
      sendVolume(l);
    },
    [sendVolume],
  );

  const toggleMute = useCallback(() => {
    touched.current.volume = Date.now();
    setVolumeState((v) => {
      if (!v) return v;
      invoke("volume_mute", { muted: !v.muted }).catch(console.warn);
      return { ...v, muted: !v.muted };
    });
  }, []);

  const setBrightness = useCallback(
    (value: number) => {
      const v = Math.round(Math.min(100, Math.max(0, value)));
      touched.current.brightness = Date.now();
      setBrightnessState(v);
      sendBrightness(v);
    },
    [sendBrightness],
  );

  return { radios, busy, volume, brightness, toggleRadio, setVolume, toggleMute, setBrightness };
}

export const openSettings = (page: "wifi" | "bluetooth" | "sound" | "display") =>
  invoke("open_settings", { page }).catch(console.warn);
