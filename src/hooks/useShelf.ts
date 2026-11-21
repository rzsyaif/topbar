import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetch } from "@tauri-apps/plugin-http";
import { load, save } from "../lib/storage";

export type FileItem = {
  path: string;
  name: string;
  kind: "image" | "video" | "file";
  size: number;
  modifiedMs: number;
};

const COLORS_KEY = "island.colors";
const PENDING_KEY = "island.clipsPendingDelete";
const MAX_COLORS = 10;
/** How long "summoned" clips can be undone before the file is deleted. */
const UNDO_MS = 8000;
/** Non-image files stay on disk a while so a paste-as-file still works. */
const FILE_GRACE_MS = 10 * 60_000;

type Pending = { path: string; at: number; kind: FileItem["kind"] };

/* ------------------------------------------------------------------ drops */

type Incoming = { name: string; bytes: Uint8Array };

const extFromType = (t: string) =>
  ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp" })[
    t.split(";")[0].trim()
  ] ?? "bin";

function nameFromUrl(url: string, type: string) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
    return `${last || "image"}.${extFromType(type)}`;
  } catch {
    return `image.${extFromType(type)}`;
  }
}

/**
 * Pulls what was dropped out of the DataTransfer. Files (from Explorer, or
 * some browsers) come through directly. Images dragged from a web page often
 * arrive only as a link, so those are downloaded.
 * Must be called synchronously inside the drop handler (the data disappears
 * once the event ends); the returned promise does the slow part.
 */
export function readDrop(dt: DataTransfer): Promise<Incoming[]> {
  const files = Array.from(dt.files);
  const html = dt.getData("text/html");
  const uri = dt.getData("text/uri-list") || dt.getData("text/plain");

  return (async () => {
    if (files.length) {
      return Promise.all(files.map(async (f) => ({ name: f.name || "clip", bytes: new Uint8Array(await f.arrayBuffer()) })));
    }
    // Prefer the <img src> from dragged HTML; fall back to the link itself.
    const imgSrc = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&");
    const src = imgSrc || uri.split(/\r?\n/).find((l) => l && !l.startsWith("#"));
    if (!src) return [];

    if (src.startsWith("data:")) {
      const [meta, b64] = src.slice(5).split(",", 2);
      const type = meta.split(";")[0];
      const bin = meta.includes("base64") ? atob(b64) : decodeURIComponent(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return [{ name: `image.${extFromType(type)}`, bytes }];
    }
    if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`Couldn't download (${res.status})`);
      const type = res.headers.get("content-type") ?? "";
      return [{ name: nameFromUrl(src, type), bytes: new Uint8Array(await res.arrayBuffer()) }];
    }
    return [];
  })();
}

/* ------------------------------------------------------------------- hook */

export function useShelf() {
  const [clips, setClips] = useState<FileItem[]>([]);
  const [captures, setCaptures] = useState<FileItem[]>([]);
  const [colors, setColors] = useState<string[]>(() => load<string[]>(COLORS_KEY, []));
  /** Most recent capture / colour, for the collapsed island's brief preview. */
  const [lastCapture, setLastCapture] = useState<{ item: FileItem; at: number } | null>(null);
  const [lastColor, setLastColor] = useState<{ hex: string; at: number } | null>(null);
  /** Clips summoned in the last few seconds (hidden, can be undone). */
  const [summoned, setSummoned] = useState<FileItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Record<string, number>>({});

  const refreshClips = useCallback(async () => {
    try {
      setClips(await invoke<FileItem[]>("clips_list"));
    } catch {
      /* not in the app */
    }
  }, []);

  useEffect(() => save(COLORS_KEY, colors), [colors]);

  useEffect(() => {
    // Finish deletions left over from last time.
    const pending = load<Pending[]>(PENDING_KEY, []);
    const keep: Pending[] = [];
    for (const p of pending) {
      const wait = p.kind === "image" ? UNDO_MS : FILE_GRACE_MS;
      if (Date.now() - p.at > wait) invoke("clip_delete", { path: p.path }).catch(() => {});
      else keep.push(p);
    }
    save(PENDING_KEY, keep);

    refreshClips();
    invoke<FileItem[]>("captures_recent", { limit: 12 }).then(setCaptures).catch(() => {});
    const un1 = listen<FileItem>("capture-added", (e) => {
      setCaptures((c) => [e.payload, ...c.filter((x) => x.path !== e.payload.path)].slice(0, 12));
      setLastCapture({ item: e.payload, at: Date.now() });
    });
    const un2 = listen<string>("color-picked", (e) => {
      const hex = e.payload.toUpperCase();
      setColors((c) => [hex, ...c.filter((x) => x !== hex)].slice(0, MAX_COLORS));
      setLastColor({ hex, at: Date.now() });
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
      Object.values(timers.current).forEach((t) => window.clearTimeout(t));
    };
  }, [refreshClips]);

  /** Save dropped / downloaded things onto the shelf. */
  const addIncoming = useCallback(
    async (incoming: Promise<Incoming[]>) => {
      setBusy(true);
      setError(null);
      try {
        const items = await incoming;
        if (!items.length) throw new Error("Nothing to add from that drop");
        for (const it of items) {
          await invoke("clip_save", it.bytes, { headers: { "x-name": encodeURIComponent(it.name) } });
        }
        await refreshClips();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refreshClips],
  );

  const pasteFromClipboard = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("clip_from_clipboard");
      await refreshClips();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshClips]);

  /**
   * "Summon" a clip: put it on the clipboard, take it off the shelf. The file
   * is deleted after a short undo window (longer for non-images, so pasting
   * them as files still works).
   */
  const summon = useCallback(async (item: FileItem) => {
    try {
      await invoke("copy_to_clipboard", { path: item.path });
    } catch (e) {
      setError(String(e));
      return false;
    }
    setClips((c) => c.filter((x) => x.path !== item.path));
    setSummoned((s) => [item, ...s]);
    const pending = load<Pending[]>(PENDING_KEY, []);
    save(PENDING_KEY, [...pending, { path: item.path, at: Date.now(), kind: item.kind }]);
    timers.current[item.path] = window.setTimeout(() => {
      setSummoned((s) => s.filter((x) => x.path !== item.path));
      if (item.kind === "image") {
        invoke("clip_delete", { path: item.path }).catch(() => {});
        save(PENDING_KEY, load<Pending[]>(PENDING_KEY, []).filter((p) => p.path !== item.path));
      }
    }, UNDO_MS);
    return true;
  }, []);

  const undoSummon = useCallback(() => {
    setSummoned((s) => {
      if (!s.length) return s;
      const [item, ...rest] = s;
      window.clearTimeout(timers.current[item.path]);
      save(PENDING_KEY, load<Pending[]>(PENDING_KEY, []).filter((p) => p.path !== item.path));
      setClips((c) => [item, ...c]);
      return rest;
    });
  }, []);

  const remove = useCallback(async (item: FileItem) => {
    setClips((c) => c.filter((x) => x.path !== item.path));
    invoke("clip_delete", { path: item.path }).catch(() => {});
  }, []);

  const copyCapture = useCallback(async (item: FileItem) => {
    try {
      await invoke("copy_to_clipboard", { path: item.path });
      return true;
    } catch {
      return false;
    }
  }, []);

  const removeColor = useCallback((hex: string) => setColors((c) => c.filter((x) => x !== hex)), []);

  return {
    clips,
    captures,
    colors,
    lastCapture,
    lastColor,
    summoned,
    busy,
    error,
    clearError: () => setError(null),
    addIncoming,
    pasteFromClipboard,
    summon,
    undoSummon,
    remove,
    copyCapture,
    removeColor,
  };
}

export const openPath = (path: string, reveal = false) => invoke("open_path", { path, reveal }).catch(console.warn);
