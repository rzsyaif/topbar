import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type MediaState = {
  hasSession: boolean;
  appId: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  updatedAtMs: number;
  artwork: string | null;
};

export type MediaAction = "toggle" | "play" | "pause" | "next" | "previous";

export function useMedia() {
  const [media, setMedia] = useState<MediaState | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<MediaState>("media_get")
      .then((m) => alive && setMedia(m))
      .catch(() => {});
    const unlisten = listen<MediaState>("media-update", (e) => setMedia(e.payload));
    return () => {
      alive = false;
      unlisten.then((f) => f());
    };
  }, []);

  const control = useCallback((action: MediaAction) => {
    // Optimistic play/pause so the button feels instant.
    if (action === "toggle") {
      setMedia((m) =>
        m ? { ...m, playing: !m.playing, positionMs: livePosition(m), updatedAtMs: Date.now() } : m,
      );
    }
    invoke("media_command", { action }).catch((e) => console.warn("media_command", e));
  }, []);

  const active = !!media?.hasSession && !!media.title;
  return { media: active ? media : null, control };
}

/** SMTC only reports position occasionally; extrapolate from the last update. */
export function livePosition(m: MediaState, now = Date.now()) {
  let pos = m.positionMs;
  if (m.playing && m.updatedAtMs > 0) pos += now - m.updatedAtMs;
  if (m.durationMs > 0) pos = Math.min(pos, m.durationMs);
  return Math.max(0, pos);
}

/** "Spotify.exe" -> "Spotify", "Chrome" -> "Chrome", etc. */
export function sourceLabel(appId: string) {
  const id = appId.toLowerCase();
  if (id.includes("spotify")) return "Spotify";
  if (id.includes("chrome")) return "Chrome";
  if (id.includes("msedge") || id.includes("edge")) return "Edge";
  if (id.includes("firefox")) return "Firefox";
  if (id.includes("zunemusic") || id.includes("media")) return "Media Player";
  return appId.split(/[\\/!]/).pop()?.replace(/\.exe$/i, "") ?? appId;
}
