import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, type FileItem, type useShelf } from "../hooks/useShelf";
import { copyText } from "../lib/clipboard";
import { CheckIcon, CloseIcon } from "./Icons";

type Shelf = ReturnType<typeof useShelf>;

const src = (p: string) => {
  try {
    return convertFileSrc(p);
  } catch {
    return p;
  }
};

/**
 * Three parts:
 * - Captures: your latest screenshots/recordings as a little photo stack that
 *   fans out on hover.
 * - Clips: a clipboard space. Drop images/files in; click one to copy it and
 *   take it off the shelf (paste it into Figma, etc.).
 * - Colours: the picker and recently picked colours.
 */
export function ShelfView({ shelf, dropping, onPick }: { shelf: Shelf; dropping: boolean; onPick: () => void }) {
  return (
    <div className="shelf">
      <Album items={shelf.captures} onCopy={shelf.copyCapture} />
      <Clips shelf={shelf} dropping={dropping} />
      <Colors colors={shelf.colors} onPick={onPick} onRemove={shelf.removeColor} />
    </div>
  );
}

/* ------------------------------------------------------------------- album */

const STACK = 4;

function Album({ items, onCopy }: { items: FileItem[]; onCopy: (i: FileItem) => Promise<boolean> }) {
  const [copied, setCopied] = useState<string | null>(null);
  const shown = items.slice(0, STACK);

  const click = async (i: FileItem) => {
    if (i.kind === "video") return openPath(i.path);
    if (await onCopy(i)) {
      setCopied(i.path);
      window.setTimeout(() => setCopied(null), 1400);
    }
  };

  return (
    <section className="shelf-album">
      <div className="shelf-head">
        <span className="shelf-label">Captures</span>
        {items.length > 0 && (
          <button className="icon-chip" title="Open folder" aria-label="Open captures folder" onClick={() => openPath(items[0].path, true)}>
            <FolderIcon />
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="shelf-empty">Screenshots and recordings show up here</div>
      ) : (
        <div className="album" style={{ ["--n" as string]: shown.length }}>
          {/* Last item drawn first so the newest sits on top of the pile. */}
          {[...shown].reverse().map((it) => {
            const i = shown.indexOf(it);
            return (
              <button
                key={it.path}
                className={`album-card ${copied === it.path ? "is-copied" : ""}`}
                style={{ ["--i" as string]: i }}
                onClick={() => click(it)}
                title={it.kind === "video" ? `${it.name} · click to open` : `${it.name} · click to copy`}
              >
                {it.kind === "video" ? (
                  <>
                    <video src={`${src(it.path)}#t=0.1`} muted preload="metadata" />
                    <span className="album-play" aria-hidden>
                      <PlayGlyph />
                    </span>
                  </>
                ) : (
                  <img src={src(it.path)} alt="" loading="lazy" />
                )}
                {copied === it.path && (
                  <span className="album-copied">
                    <CheckIcon />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- clips */

function Clips({ shelf, dropping }: { shelf: Shelf; dropping: boolean }) {
  const [leaving, setLeaving] = useState<string | null>(null);
  const last = shelf.summoned[0];

  const summon = async (it: FileItem) => {
    setLeaving(it.path);
    // Let the lift-off animation play, then hand it over.
    window.setTimeout(async () => {
      await shelf.summon(it);
      setLeaving(null);
    }, 220);
  };

  return (
    <section className={`shelf-clips ${dropping ? "is-dropping" : ""}`}>
      <div className="shelf-head">
        <span className="shelf-label">
          Clips {shelf.clips.length > 0 && <span className="shelf-count">{shelf.clips.length}</span>}
        </span>
        <button className="icon-chip" title="Add from clipboard" aria-label="Add from clipboard" onClick={shelf.pasteFromClipboard}>
          <PasteIcon />
        </button>
      </div>

      {shelf.clips.length === 0 && !dropping ? (
        <div className="drop-zone">
          <DropIcon />
          <span>Drop images or files here</span>
          <span className="drop-sub">Click one later to copy it, then paste anywhere</span>
        </div>
      ) : (
        <div className="clip-grid">
          {shelf.clips.map((it) => (
            <div key={it.path} className={`clip ${leaving === it.path ? "is-leaving" : ""}`}>
              <button className="clip-body" onClick={() => summon(it)} title={`${it.name} · click to copy`}>
                {it.kind === "image" ? (
                  <img src={src(it.path)} alt="" loading="lazy" />
                ) : (
                  <span className="clip-file">
                    <span className="clip-ext">{it.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span>
                    <span className="clip-name">{it.name}</span>
                  </span>
                )}
              </button>
              <button className="clip-remove" aria-label={`Remove ${it.name}`} onClick={() => shelf.remove(it)}>
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {dropping && (
        <div className="drop-overlay">
          <DropIcon />
          Drop to add to Clips
        </div>
      )}
      {shelf.busy && <div className="shelf-status">Adding…</div>}
      {!shelf.busy && shelf.error && (
        <button className="shelf-status is-error" onClick={shelf.clearError}>
          {shelf.error}
        </button>
      )}
      {!shelf.busy && !shelf.error && last && (
        <div className="shelf-status">
          Copied · paste it anywhere
          <button className="text-btn" onClick={shelf.undoSummon}>
            Undo
          </button>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ colours */

function Colors({ colors, onPick, onRemove }: { colors: string[]; onPick: () => void; onRemove: (hex: string) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (hex: string) => {
    if (await copyText(hex)) {
      setCopied(hex);
      window.setTimeout(() => setCopied(null), 1200);
    }
  };
  return (
    <section className="shelf-colors">
      <button className="dropper" onClick={onPick} title="Pick a colour from the screen" aria-label="Pick a colour from the screen">
        <DropperIcon />
      </button>
      {colors.length === 0 ? (
        <span className="shelf-hint">Pick a colour from anywhere on screen. The hex code is copied.</span>
      ) : (
        <div className="swatches">
          {colors.map((hex) => (
            <button
              key={hex}
              className={`swatch ${copied === hex ? "is-copied" : ""}`}
              style={{ background: hex }}
              title={`${hex} · click to copy, right-click to remove`}
              aria-label={`Copy ${hex}`}
              onClick={() => copy(hex)}
              onContextMenu={(e) => {
                e.preventDefault();
                onRemove(hex);
              }}
            >
              <span className="swatch-hex">{copied === hex ? "Copied" : hex}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------- icons */

const ic = { width: 13, height: 13, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const FolderIcon = () => (
  <svg {...ic}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.4l2 2h7.6A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z" />
  </svg>
);
const PasteIcon = () => (
  <svg {...ic}>
    <rect x="6" y="4.5" width="12" height="16" rx="2.5" />
    <path d="M9.5 4.5V4a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 4v.5" />
    <path d="M12 10v6M9 13h6" />
  </svg>
);
const DropIcon = () => (
  <svg {...ic} width={18} height={18}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M4.5 15.5v2A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
  </svg>
);
const DropperIcon = () => (
  <svg {...ic} width={16} height={16}>
    <path d="m14.5 6.5 3 3" />
    <path d="M17.6 3.4a2.1 2.1 0 0 1 3 3l-2.6 2.6-3-3z" fill="currentColor" />
    <path d="M15.5 8.5 7 17l-3 1 1-3 8.5-8.5" />
  </svg>
);
const PlayGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" />
  </svg>
);
