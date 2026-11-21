import type { useWellness } from "../hooks/useWellness";
import type { WellnessSettings } from "../hooks/useSettings";

type Wellness = ReturnType<typeof useWellness>;

export const DropGlyph = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3.2s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Z" />
    <path d="M9.2 14.6a2.9 2.9 0 0 0 2.6 2.7" opacity=".6" />
  </svg>
);

export const StandGlyph = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="4.6" r="1.9" />
    <path d="M12 8.4v6.2M12 14.6l-2.6 6M12 14.6l2.6 6M7.4 11l4.6-2.6 4.6 2.6" />
  </svg>
);

const hhmm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const inMin = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m} min`;
};

/** Water + standing, at the top of the Today tab. */
export function WellnessStrip({
  w,
  s,
  now,
  settingsOpen,
  onOpenSettings,
}: {
  w: Wellness;
  s: WellnessSettings;
  now: number;
  settingsOpen: boolean;
  onOpenSettings: (el: HTMLElement) => void;
}) {
  const sub = (on: boolean, nextAt: number) =>
    !on ? "Reminders off" : !w.active ? `Resumes at ${hhmm(s.fromHour)}` : `Next in ${inMin(nextAt - now)}`;
  const goalPct = Math.min(1, w.water.count / Math.max(1, s.waterGoal));

  return (
    <div className="well">
      <div className={`well-tile well-water ${w.pending.water ? "is-due" : ""}`}>
        <span className="well-icon" aria-hidden>
          <WaterRing pct={goalPct} />
          <DropGlyph size={13} />
        </span>
        <div className="well-text">
          <div className="well-main tabular">
            {w.pending.water ? "Time for some water" : `${w.water.count} / ${s.waterGoal} glasses`}
          </div>
          <div className="well-sub tabular">
            {w.pending.water ? `Glass ${w.water.count + 1} of ${s.waterGoal}` : w.water.count >= s.waterGoal ? "Goal reached today" : sub(s.waterOn, w.water.nextAt)}
          </div>
        </div>
        {w.pending.water ? (
          <div className="well-actions">
            <button className="well-btn" onClick={() => w.later("water")}>Later</button>
            <button className="well-btn is-primary" onClick={() => w.done("water")}>Drank</button>
          </div>
        ) : (
          <button
            className="well-add"
            aria-label="Log a glass of water"
            title="Log a glass (right-click to undo)"
            onClick={() => w.done("water")}
            onContextMenu={(e) => {
              e.preventDefault();
              w.undoWater();
            }}
          >
            +
          </button>
        )}
      </div>

      <div className={`well-tile well-stand ${w.pending.stand ? "is-due" : ""}`}>
        <span className="well-icon" aria-hidden>
          <StandGlyph size={14} />
        </span>
        <div className="well-text">
          <div className="well-main tabular">
            {w.pending.stand ? "Time to stand up" : w.stand.count ? `Stood up ${w.stand.count}×` : "Not up yet today"}
          </div>
          <div className="well-sub tabular">{w.pending.stand ? "Stretch for a minute" : sub(s.standOn, w.stand.nextAt)}</div>
        </div>
        {w.pending.stand ? (
          <div className="well-actions">
            <button className="well-btn" onClick={() => w.later("stand")}>Later</button>
            <button className="well-btn is-primary" onClick={() => w.done("stand")}>Done</button>
          </div>
        ) : (
          <button className="well-add" aria-label="I stood up" title="I stood up" onClick={() => w.done("stand")}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </button>
        )}
      </div>

      <button
        className={`well-gear ${settingsOpen ? "is-open" : ""}`}
        aria-label="Reminder settings"
        aria-expanded={settingsOpen}
        title="Reminder settings"
        onClick={(e) => onOpenSettings(e.currentTarget)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      </button>
    </div>
  );
}

function WaterRing({ pct }: { pct: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg className="well-ring" width="30" height="30" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r={r} className="well-ring-bg" />
      <circle cx="15" cy="15" r={r} className="well-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
    </svg>
  );
}
