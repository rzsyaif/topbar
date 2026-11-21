import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { NOTE_COLORS, type Note, type useNotes } from "../hooks/useNotes";
import { CheckIcon, CloseIcon } from "./Icons";

type Notes = ReturnType<typeof useNotes>;

export const NOTE_W = 132;
export const NOTE_H = 116;
const PAD = 8; // keep notes this far from the board edge
const LEAVE_MS = 260;
/** Delay between each note when the board clears, so they go one after another. */
const CLEAR_STAGGER_MS = 45;
/** How long the undo button stays after clearing. */
const UNDO_MS = 6000;

/**
 * Notes as a bulleted list, in reading order on the board: top to bottom,
 * then left to right for notes at roughly the same height. Multi-line notes
 * keep their line breaks, indented under the bullet. Empty notes are skipped.
 */
export function notesToList(notes: Note[]) {
  const ROW = 40; // px: notes closer than this vertically count as one row
  return [...notes]
    .filter((n) => n.text.trim())
    .sort((a, b) => (Math.abs(a.y - b.y) < ROW ? a.x - b.x : a.y - b.y))
    .map((n) => {
      const [first, ...rest] = n.text.trim().split(/\r?\n/);
      return [`* ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
    })
    .join("\n");
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for when the Clipboard API isn't available.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/**
 * A small corkboard inside the island. Pull a note off the pad (bottom-right),
 * drag it anywhere on the board, type on it, and toss it with ×.
 */
export function NotesBoard({ notes, onHold }: { notes: Notes; onHold: (held: boolean) => void }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLButtonElement>(null);
  const [entering, setEntering] = useState<Record<string, { fx: number; fy: number }>>({});
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaveOrder, setLeaveOrder] = useState<Record<string, number>>({});
  const [undo, setUndo] = useState<Note[] | null>(null);
  const undoTimer = useRef<number>();
  const hasText = notes.notes.some((n) => n.text.trim());

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  /** Copy every note as a list, then clear the board (with a short undo). */
  const copyAll = async () => {
    if (!hasText || leaving.size) return;
    if (!(await copyText(notesToList(notes.notes)))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);

    const snapshot = notes.notes;
    // Toss them in reading order, one after another.
    const order = [...snapshot].sort((a, b) => (Math.abs(a.y - b.y) < 40 ? a.x - b.x : a.y - b.y));
    setLeaveOrder(Object.fromEntries(order.map((n, i) => [n.id, i])));
    setLeaving(new Set(snapshot.map((n) => n.id)));
    window.setTimeout(() => {
      notes.clear();
      setLeaving(new Set());
      setLeaveOrder({});
    }, LEAVE_MS + order.length * CLEAR_STAGGER_MS);

    setUndo(snapshot);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  };

  const undoClear = () => {
    if (!undo) return;
    window.clearTimeout(undoTimer.current);
    notes.restore(undo);
    setUndo(null);
    setLeaving(new Set());
    setLeaveOrder({});
  };

  const bounds = () => {
    const b = boardRef.current!;
    return { w: b.clientWidth, h: b.clientHeight };
  };
  const clamp = (x: number, y: number) => {
    const { w, h } = bounds();
    return {
      x: Math.min(Math.max(PAD, x), w - NOTE_W - PAD),
      y: Math.min(Math.max(PAD, y), h - NOTE_H - PAD),
    };
  };

  const pullNote = () => {
    const { w, h } = bounds();
    const pad = padRef.current!;
    const padX = pad.offsetLeft + pad.offsetWidth / 2 - NOTE_W / 2;
    const padY = pad.offsetTop + pad.offsetHeight / 2 - NOTE_H / 2;
    // Land somewhere left of / above the pad, scattered a little.
    const spot = clamp(
      PAD + Math.random() * (w - NOTE_W - 96 - PAD),
      PAD + Math.random() * (h - NOTE_H - PAD * 2),
    );
    const id = notes.add(spot.x, spot.y);
    setEntering((e) => ({ ...e, [id]: { fx: padX - spot.x, fy: padY - spot.y } }));
    setFocusId(id);
  };

  const toss = (id: string) => {
    setLeaving((s) => new Set(s).add(id));
    window.setTimeout(() => {
      notes.remove(id);
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, LEAVE_MS);
  };

  return (
    <div className="board" ref={boardRef}>
      {notes.notes.length === 0 && (
        <div className="board-empty">{undo ? "Copied to clipboard. Board cleared." : "Pull a note off the pad to start"}</div>
      )}

      {notes.notes.map((n) => (
        <StickyNote
          key={n.id}
          note={n}
          enter={entering[n.id]}
          leaving={leaving.has(n.id)}
          leaveDelay={(leaveOrder[n.id] ?? 0) * CLEAR_STAGGER_MS}
          autoFocus={focusId === n.id}
          onEntered={() =>
            setEntering((e) => {
              const { [n.id]: _, ...rest } = e;
              return rest;
            })
          }
          onFront={() => notes.bringToFront(n.id)}
          onMove={(x, y) => notes.update(n.id, clamp(x, y))}
          onText={(text) => notes.update(n.id, { text })}
          onColor={() => notes.update(n.id, { color: (n.color + 1) % NOTE_COLORS.length })}
          onDelete={() => toss(n.id)}
          onHold={onHold}
        />
      ))}

      <button
        className={`board-copy ${copied ? "is-copied" : ""}`}
        onClick={copyAll}
        disabled={!hasText}
        aria-label={copied ? "Copied" : "Copy all notes as a list and clear the board"}
        title={copied ? "Copied" : "Copy all & clear"}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      {undo && (
        <button className="board-undo" onClick={undoClear} aria-label="Undo clear" title="Undo">
          <UndoIcon />
        </button>
      )}

      <button ref={padRef} className="pad" onClick={pullNote} aria-label="New sticky note" title="New note">
        <span className="pad-sheet pad-sheet-3" />
        <span className="pad-sheet pad-sheet-2" />
        <span className="pad-sheet pad-sheet-1" style={{ background: NOTE_COLORS[notes.nextColor] }}>
          +
        </span>
      </button>
    </div>
  );
}

function StickyNote({
  note,
  enter,
  leaving,
  leaveDelay,
  autoFocus,
  onEntered,
  onFront,
  onMove,
  onText,
  onColor,
  onDelete,
  onHold,
}: {
  note: Note;
  enter?: { fx: number; fy: number };
  leaving: boolean;
  leaveDelay: number;
  autoFocus: boolean;
  onEntered: () => void;
  onFront: () => void;
  onMove: (x: number, y: number) => void;
  onText: (t: string) => void;
  onColor: () => void;
  onDelete: () => void;
  onHold: (held: boolean) => void;
}) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    onFront();
    // Typing and buttons keep their own behaviour; drag from anywhere else.
    const target = e.target as HTMLElement;
    if (target.closest("textarea, button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - note.x, dy: e.clientY - note.y };
    setDragging(true);
    onHold(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    onMove(e.clientX - drag.current.dx, e.clientY - drag.current.dy);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    onHold(false);
  };

  const style = {
    left: note.x,
    top: note.y,
    width: NOTE_W,
    height: NOTE_H,
    zIndex: note.z,
    background: NOTE_COLORS[note.color],
    "--rot": `${note.rot}deg`,
    "--fx": `${enter?.fx ?? 0}px`,
    "--fy": `${enter?.fy ?? 0}px`,
    animationDelay: leaving && leaveDelay ? `${leaveDelay}ms` : undefined,
  } as CSSProperties;

  return (
    <div
      className={["note", enter ? "is-entering" : "", leaving ? "is-leaving" : "", dragging ? "is-dragging" : ""].join(" ")}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onAnimationEnd={(e) => e.animationName === "note-pull" && onEntered()}
    >
      <div className="note-bar">
        <button className="note-color" onClick={onColor} aria-label="Change colour" title="Change colour" />
        <span className="note-grip" aria-hidden>
          <i /><i /><i />
        </span>
        <button className="note-delete" onClick={onDelete} aria-label="Delete note" title="Delete">
          <CloseIcon />
        </button>
      </div>
      <textarea
        ref={textRef}
        className="note-text"
        placeholder="Write something…"
        value={note.text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
        spellCheck={false}
      />
    </div>
  );
}

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </svg>
);

const UndoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);
