import { useEffect, useRef, useState } from "react";
import { PHASES, type useTasbih } from "../hooks/useTasbih";
import { ResetIcon } from "./Icons";

type Tasbih = ReturnType<typeof useTasbih>;

const R = 64;
const C = 2 * Math.PI * R;

/**
 * Tap the bead (or press Space / Enter) to count. 33 · 33 · 34 by default,
 * or a free count. Each tap gives a soft ripple; finishing a dhikr glows gold.
 */
export function TasbihView({ t }: { t: Tasbih }) {
  const [ripples, setRipples] = useState<number[]>([]);
  const [glow, setGlow] = useState<"phase" | "done" | null>(null);
  const beadRef = useRef<HTMLButtonElement>(null);

  const free = t.mode === "free";
  const phase = PHASES[Math.min(t.phase, PHASES.length - 1)];
  const count = free ? t.free : t.done ? 100 : t.count;
  const target = free ? 33 : phase.target;
  const progress = free ? (t.free % 33) / 33 : t.done ? 1 : t.count / target;

  useEffect(() => {
    if (!t.milestone) return;
    setGlow(t.milestone.kind);
    const id = window.setTimeout(() => setGlow(null), t.milestone.kind === "done" ? 1800 : 900);
    return () => window.clearTimeout(id);
  }, [t.milestone]);

  const tap = () => {
    if (t.done) return;
    t.tap();
    const id = Date.now() + Math.random();
    setRipples((r) => [...r.slice(-4), id]);
    window.setTimeout(() => setRipples((r) => r.filter((x) => x !== id)), 650);
  };

  // Space / Enter count while the Tasbih tab is open (and you're not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) beadRef.current?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`tasbih ${glow ? `glow-${glow}` : ""}`}>
      <div className="tasbih-side">
        <div className="seg" role="radiogroup" aria-label="Counting mode">
          <button role="radio" aria-checked={!free} className={`seg-btn ${!free ? "is-active" : ""}`} onClick={() => t.setMode("tasbih")}>
            33·33·34
          </button>
          <button role="radio" aria-checked={free} className={`seg-btn ${free ? "is-active" : ""}`} onClick={() => t.setMode("free")}>
            Free
          </button>
        </div>

        {!free && (
          <ol className="tasbih-steps">
            {PHASES.map((p, i) => (
              <li key={p.latin} className={i < t.phase ? "is-done" : i === t.phase ? "is-current" : ""}>
                <span className="step-dot" aria-hidden />
                <span className="step-name">{p.latin}</span>
                <span className="step-n tabular">{p.target}</span>
              </li>
            ))}
          </ol>
        )}

        <div className="tasbih-foot">
          <span className="tasbih-today tabular">{t.today} today</span>
          <button className="icon-chip" onClick={t.reset} aria-label="Reset counter" title="Reset">
            <ResetIcon />
          </button>
        </div>
      </div>

      <button ref={beadRef} className="bead" onClick={tap} aria-label={`Count. ${count} of ${target}`} disabled={t.done}>
        <svg className="bead-ring" viewBox="0 0 160 160" aria-hidden>
          <circle cx="80" cy="80" r={R} className="bead-track" />
          <circle cx="80" cy="80" r={R} className="bead-progress" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
        </svg>
        {ripples.map((id) => (
          <span key={id} className="bead-ripple" aria-hidden />
        ))}
        <span className="bead-inner">
          {t.done ? (
            <>
              <span className="bead-arabic">ٱلْحَمْدُ لِلَّٰهِ</span>
              <span className="bead-count tabular">100</span>
              <span className="bead-latin">Complete</span>
            </>
          ) : (
            <>
              {!free && <span className="bead-arabic">{phase.arabic}</span>}
              <span className="bead-count tabular" key={count}>
                {count}
              </span>
              <span className="bead-latin">{free ? "Tap to count" : `${phase.latin} · ${t.count}/${target}`}</span>
            </>
          )}
        </span>
      </button>

      {t.done && (
        <button className="tasbih-again text-btn" onClick={t.reset}>
          Again
        </button>
      )}
    </div>
  );
}
