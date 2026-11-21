import { useEffect, useState } from "react";
import { fetch } from "@tauri-apps/plugin-http";
import type { MediaState } from "./useMedia";

export type LyricLine = { timeMs: number; text: string };
export type Lyrics =
  | { status: "idle" | "loading" | "none" }
  | { status: "synced"; lines: LyricLine[] }
  | { status: "plain"; text: string }
  | { status: "instrumental" };

type LrclibTrack = {
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

const API = "https://lrclib.net/api";
const cache = new Map<string, Lyrics>();

/** Browser tabs often report titles like "Song (Official Video)". Strip the noise. */
export function cleanTitle(title: string) {
  return title
    .replace(/\s*[([][^)\]]*(official|video|lyric|audio|visuali[sz]er|mv|m\/v|hd|4k)[^)\]]*[)\]]/gi, "")
    .replace(/\s*\|.*$/, "")
    .trim();
}

export function cleanArtist(artist: string) {
  return artist.replace(/\s*-\s*Topic$/i, "").replace(/VEVO$/i, "").trim();
}

export function parseLrc(lrc: string): LyricLine[] {
  const stamp = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const times = [...raw.matchAll(stamp)];
    if (!times.length) continue;
    const text = raw.replace(stamp, "").trim();
    for (const t of times) {
      lines.push({ timeMs: (Number(t[1]) * 60 + Number(t[2])) * 1000, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function toLyrics(t: LrclibTrack | undefined | null): Lyrics | null {
  if (!t) return null;
  if (t.instrumental) return { status: "instrumental" };
  if (t.syncedLyrics) return { status: "synced", lines: parseLrc(t.syncedLyrics) };
  if (t.plainLyrics) return { status: "plain", text: t.plainLyrics };
  return null;
}

async function fetchLyrics(m: MediaState): Promise<Lyrics> {
  const track = cleanTitle(m.title);
  const artist = cleanArtist(m.artist);
  const headers = { "Lrclib-Client": "Island (Windows dynamic island)" };

  // 1. Exact match (best when album + duration are known, e.g. Spotify).
  if (artist) {
    const q = new URLSearchParams({ track_name: track, artist_name: artist });
    if (m.album) q.set("album_name", m.album);
    if (m.durationMs > 0) q.set("duration", String(Math.round(m.durationMs / 1000)));
    const res = await fetch(`${API}/get?${q}`, { headers });
    if (res.ok) {
      const hit = toLyrics(await res.json());
      if (hit) return hit;
    }
  }

  // 2. Fuzzy search; prefer a result with synced lyrics.
  const q = new URLSearchParams({ track_name: track });
  if (artist) q.set("artist_name", artist);
  const res = await fetch(`${API}/search?${q}`, { headers });
  if (res.ok) {
    const results = (await res.json()) as LrclibTrack[];
    const best = results.find((r) => r.syncedLyrics) ?? results.find((r) => r.plainLyrics);
    const hit = toLyrics(best);
    if (hit) return hit;
  }
  return { status: "none" };
}

export function useLyrics(media: MediaState | null) {
  const [lyrics, setLyrics] = useState<Lyrics>({ status: "idle" });
  const key = media ? `${media.title}|${media.artist}` : "";

  useEffect(() => {
    if (!media || !key) {
      setLyrics({ status: "idle" });
      return;
    }
    const cached = cache.get(key);
    if (cached) {
      setLyrics(cached);
      return;
    }
    let alive = true;
    setLyrics({ status: "loading" });
    fetchLyrics(media)
      .then((l) => {
        cache.set(key, l);
        if (alive) setLyrics(l);
      })
      .catch(() => alive && setLyrics({ status: "none" }));
    return () => {
      alive = false;
    };
    // Only refetch when the track changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return lyrics;
}

/** Index of the line being sung at `positionMs`, or -1 before the first line. */
export function currentLineIndex(lines: LyricLine[], positionMs: number) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= positionMs) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
