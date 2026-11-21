import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { METHODS, methodById, suggestMethod, type MethodId } from "../lib/prayerMethods";
import { searchCities, type CityResult, type Place } from "../hooks/useLocation";
import type { PrayerKey, PrayerSettings, PomodoroSettings, WellnessSettings, useSettings } from "../hooks/useSettings";
import type { useUpdater } from "../hooks/useUpdater";
import { DEFAULTS } from "../hooks/useSettings";
import type { PrayerTime } from "../hooks/usePrayer";
import { clock } from "../lib/format";

type SettingsApi = ReturnType<typeof useSettings>;

/* -------------------------------------------------------------- building blocks */

/** − value + . Click, press-and-hold to repeat, or scroll over it. */
function Stepper({
  value,
  min,
  max,
  step = 1,
  format = (v) => String(v),
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  label: string;
}) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const repeat = useRef<{ t?: number; i?: number }>({});

  const bump = (dir: 1 | -1) => {
    const next = Math.min(max, Math.max(min, valueRef.current + dir * step));
    if (next !== valueRef.current) onChange(next);
  };
  const stop = () => {
    window.clearTimeout(repeat.current.t);
    window.clearInterval(repeat.current.i);
  };
  const press = (dir: 1 | -1) => {
    bump(dir);
    stop();
    repeat.current.t = window.setTimeout(() => {
      repeat.current.i = window.setInterval(() => bump(dir), 70);
    }, 380);
  };
  useEffect(() => stop, []);

  const onWheel = (e: WheelEvent) => bump(e.deltaY < 0 ? 1 : -1);

  return (
    <div className="stepper" onWheel={onWheel} role="spinbutton" aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}>
      <button
        className="stepper-btn"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onPointerDown={() => press(-1)}
        onPointerUp={stop}
        onPointerLeave={stop}
      >
        −
      </button>
      <span className="stepper-value tabular">{format(value)}</span>
      <button
        className="stepper-btn"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onPointerDown={() => press(1)}
        onPointerUp={stop}
        onPointerLeave={stop}
      >
        +
      </button>
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className={`switch ${on ? "is-on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        {label}
        {hint && <span className="set-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const mins = (v: number) => `${v} min`;
const signed = (v: number) => (v === 0 ? "0" : v > 0 ? `+${v}` : `−${Math.abs(v)}`);

/* -------------------------------------------------------------- the popovers */

export function PrayerSettingsPanel({ api, today }: { api: SettingsApi; today: PrayerTime[] }) {
  const p: PrayerSettings = api.settings.prayer;
  const changed = JSON.stringify(p) !== JSON.stringify(DEFAULTS.prayer);
  const setAdj = (k: PrayerKey, v: number) => api.setPrayer({ adjustments: { ...p.adjustments, [k]: v } });

  return (
    <>
      <div className="set-title">Calculation</div>
      <MethodPicker value={p.method} onChange={(method) => api.setPrayer({ method })} />
      <Row label="Asr" hint={p.madhab === "hanafi" ? "Hanafi (later)" : "Shafi'i, Maliki, Hanbali"}>
        <Seg
          value={p.madhab}
          options={[
            ["shafi", "Standard"],
            ["hanafi", "Hanafi"],
          ]}
          onChange={(madhab) => api.setPrayer({ madhab })}
        />
      </Row>

      <div className="set-title set-title-sub">Reminders</div>
      <Row label="Countdown starts" hint="before each prayer">
        <Stepper label="minutes before each prayer" value={p.leadMinutes} min={1} max={60} format={mins} onChange={(v) => api.setPrayer({ leadMinutes: v })} />
      </Row>
      <Row label="Jumu'ah" hint="Friday Dhuhr">
        <Stepper
          label="minutes before Jumu'ah"
          value={p.jumuahLeadMinutes}
          min={5}
          max={120}
          step={5}
          format={mins}
          onChange={(v) => api.setPrayer({ jumuahLeadMinutes: v })}
        />
      </Row>
      <Row label="Notification">
        <Switch label="Windows notification" on={p.notify} onChange={(v) => api.setPrayer({ notify: v })} />
      </Row>

      <div className="set-title set-title-sub">Adjust times</div>
      {today.map((t) => {
        const k = t.name.toLowerCase() as PrayerKey;
        return (
          <Row key={k} label={t.label} hint={clock(t.time)}>
            <Stepper label={`${t.label} adjustment in minutes`} value={p.adjustments[k]} min={-30} max={30} format={signed} onChange={(v) => setAdj(k, v)} />
          </Row>
        );
      })}

      <div className="set-foot">
        <span className="set-note">Minutes added to the calculated time</span>
        <button className="text-btn" onClick={api.resetPrayer} disabled={!changed}>
          Reset
        </button>
      </div>
    </>
  );
}

const PRESETS: [number, number][] = [
  [25, 5],
  [50, 10],
  [90, 15],
];

export function FocusSettingsPanel({ api, running }: { api: SettingsApi; running: boolean }) {
  const f: PomodoroSettings = api.settings.pomodoro;
  const changed = JSON.stringify(f) !== JSON.stringify(DEFAULTS.pomodoro);

  return (
    <>
      <div className="set-title">Focus timer</div>
      <div className="set-presets" role="group" aria-label="Presets">
        {PRESETS.map(([fm, bm]) => {
          const active = f.focusMinutes === fm && f.breakMinutes === bm;
          return (
            <button key={fm} className={`preset ${active ? "is-active" : ""}`} onClick={() => api.setPomodoro({ focusMinutes: fm, breakMinutes: bm })}>
              <span className="tabular">{fm}</span>
              <span className="preset-sep">/</span>
              <span className="tabular">{bm}</span>
            </button>
          );
        })}
      </div>
      <Row label="Focus">
        <Stepper label="focus minutes" value={f.focusMinutes} min={5} max={180} step={5} format={mins} onChange={(v) => api.setPomodoro({ focusMinutes: v })} />
      </Row>
      <Row label="Break">
        <Stepper label="break minutes" value={f.breakMinutes} min={1} max={60} format={mins} onChange={(v) => api.setPomodoro({ breakMinutes: v })} />
      </Row>
      <div className="set-foot">
        <span className="set-note">{running ? "Applies from the next session" : "Applies right away"}</span>
        <button className="text-btn" onClick={api.resetPomodoro} disabled={!changed}>
          Reset
        </button>
      </div>
    </>
  );
}

function UpdateRow({ updater }: { updater: ReturnType<typeof useUpdater> }) {
  const st = updater.status;
  if (st.kind === "available") {
    return (
      <Row label={`Island ${st.version} is ready`} hint="Installs quietly, then restarts">
        <button className="chip chip-label chip-accent" onClick={updater.install}>
          Update
        </button>
      </Row>
    );
  }
  if (st.kind === "installing") {
    return (
      <Row label="Updating…" hint={st.progress === null ? "Downloading" : `Downloading ${Math.round(st.progress * 100)}%`}>
        <span className="update-spinner" aria-hidden />
      </Row>
    );
  }
  const hint =
    st.kind === "checking"
      ? "Checking…"
      : st.kind === "latest"
        ? "You're on the latest version"
        : st.kind === "off"
          ? "Not set up in this build"
          : st.kind === "error"
            ? st.message
            : "Checks automatically every few hours";
  return (
    <Row label="Check for updates" hint={hint}>
      <button className="chip chip-label" onClick={updater.check} disabled={st.kind === "checking" || st.kind === "off"}>
        Check
      </button>
    </Row>
  );
}

const hour = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

export function WellnessSettingsPanel({ api }: { api: SettingsApi }) {
  const w: WellnessSettings = api.settings.wellness;
  const changed = JSON.stringify(w) !== JSON.stringify(DEFAULTS.wellness);
  return (
    <>
      <div className="set-title">Water</div>
      <Row label="Remind me to drink">
        <Switch label="Water reminders" on={w.waterOn} onChange={(v) => api.setWellness({ waterOn: v })} />
      </Row>
      {w.waterOn && (
        <>
          <Row label="Every">
            <Stepper label="minutes between water reminders" value={w.waterEvery} min={15} max={180} step={5} format={mins} onChange={(v) => api.setWellness({ waterEvery: v })} />
          </Row>
          <Row label="Daily goal">
            <Stepper label="glasses a day" value={w.waterGoal} min={2} max={20} format={(v) => `${v} glasses`} onChange={(v) => api.setWellness({ waterGoal: v })} />
          </Row>
        </>
      )}

      <div className="set-title set-title-sub">Standing</div>
      <Row label="Remind me to stand" hint="Being away 5 min counts">
        <Switch label="Stand-up reminders" on={w.standOn} onChange={(v) => api.setWellness({ standOn: v })} />
      </Row>
      {w.standOn && (
        <Row label="Every">
          <Stepper label="minutes between stand-up reminders" value={w.standEvery} min={15} max={180} step={5} format={mins} onChange={(v) => api.setWellness({ standEvery: v })} />
        </Row>
      )}

      <div className="set-title set-title-sub">When</div>
      <Row label="From">
        <Stepper label="reminders start at" value={w.fromHour} min={0} max={23} format={hour} onChange={(v) => api.setWellness({ fromHour: v })} />
      </Row>
      <Row label="Until">
        <Stepper label="reminders end at" value={w.toHour} min={1} max={24} format={hour} onChange={(v) => api.setWellness({ toHour: v })} />
      </Row>
      <Row label="Windows notification" hint="As well as the island">
        <Switch label="Windows notification" on={w.notify} onChange={(v) => api.setWellness({ notify: v })} />
      </Row>
      <div className="set-foot">
        <span className="set-note">Paused in full-screen games and presentations</span>
        <button className="text-btn" onClick={api.resetWellness} disabled={!changed}>
          Reset
        </button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------- shared pieces */

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg seg-sm" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} className={`seg-btn ${value === v ? "is-active" : ""}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Current method; click to choose from the list. */
export function MethodPicker({ value, onChange, suggested }: { value: MethodId; onChange: (m: MethodId) => void; suggested?: MethodId }) {
  const [open, setOpen] = useState(false);
  const m = methodById(value);
  return (
    <div className={`picker-field ${open ? "is-open" : ""}`}>
      <button className="picker-current" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="set-label">
          {m.label}
          <span className="set-hint">{m.region}</span>
        </span>
        <span className="picker-chev" aria-hidden>
          ⌄
        </span>
      </button>
      {open && (
        <ul className="picker-list" role="listbox">
          {METHODS.map((x) => (
            <li key={x.id}>
              <button
                role="option"
                aria-selected={x.id === value}
                className={`picker-option ${x.id === value ? "is-active" : ""}`}
                onClick={() => {
                  onChange(x.id);
                  setOpen(false);
                }}
              >
                <span className="set-label">
                  {x.label}
                  <span className="set-hint">{x.region}</span>
                </span>
                {x.id === suggested && x.id !== value && <span className="picker-tag">Suggested</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search for a city (Open-Meteo geocoding). */
export function CitySearch({ onPick, autoFocus }: { onPick: (c: CityResult) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CityResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setBusy(true);
    const id = window.setTimeout(async () => {
      try {
        const r = await searchCities(q);
        if (alive) setResults(r);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setBusy(false);
      }
    }, 280);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [q]);

  return (
    <div className="city-search">
      <input className="city-input" placeholder="Search a city" value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} />
      {(results.length > 0 || busy) && (
        <ul className="city-results">
          {busy && results.length === 0 && <li className="set-hint city-busy">Searching…</li>}
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button
                className="picker-option"
                onClick={() => {
                  onPick(r);
                  setQ("");
                  setResults([]);
                }}
              >
                <span className="set-label">
                  {r.name}
                  <span className="set-hint">{[r.admin, r.country].filter(Boolean).join(", ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------- general settings */

export function GeneralPanel({
  api,
  place,
  updater,
  onRerunSetup,
}: {
  api: SettingsApi;
  place: Place;
  updater: ReturnType<typeof useUpdater>;
  onRerunSetup: () => void;
}) {
  const g = api.settings.general;
  const loc = api.settings.location;
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState("");
  const suggestion = suggestMethod(place.countryCode).method;
  const showSuggestion = !!place.countryCode && suggestion !== api.settings.prayer.method;

  useEffect(() => {
    invoke<boolean>("autostart_get").then(setAutostart).catch(() => setAutostart(null));
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <>
      <div className="set-title">Location</div>
      <Row label={place.name} hint={loc.mode === "manual" ? "Chosen city" : place.source === "device" ? "From this PC's location" : "Last known location"}>
        <Seg
          value={loc.mode}
          options={[
            ["auto", "Auto"],
            ["manual", "City"],
          ]}
          onChange={(mode) => api.setLocation({ mode })}
        />
      </Row>
      {loc.mode === "manual" && (
        <CitySearch
          onPick={(c) =>
            api.setLocation({
              mode: "manual",
              city: { name: c.name, country: c.country, countryCode: c.countryCode, latitude: c.latitude, longitude: c.longitude },
            })
          }
        />
      )}
      {showSuggestion && (
        <button className="suggest" onClick={() => api.setPrayer({ method: suggestion, madhab: suggestMethod(place.countryCode).madhab })}>
          Use <b>{methodById(suggestion).label}</b> prayer times for this region
        </button>
      )}

      <div className="set-title set-title-sub">Display</div>
      <Row label="24-hour time">
        <Switch label="24-hour time" on={g.use24h} onChange={(v) => api.setGeneral({ use24h: v })} />
      </Row>
      <Row label="Liquid glass" hint="Glassy edges and light">
        <Switch label="Liquid glass" on={g.glass} onChange={(v) => api.setGeneral({ glass: v })} />
      </Row>
      <Row label="3D tilt" hint="Leans toward the cursor">
        <Switch label="3D tilt" on={g.tilt} onChange={(v) => api.setGeneral({ tilt: v })} />
      </Row>

      <div className="set-title set-title-sub">System</div>
      <Row label="Start with Windows">
        <Switch
          label="Start with Windows"
          on={!!autostart}
          onChange={(v) =>
            invoke<boolean>("autostart_set", { on: v })
              .then(setAutostart)
              .catch(() => {})
          }
        />
      </Row>
      <Row label="Hide in screenshots" hint="Keeps the island out of captures">
        <Switch label="Hide in screenshots" on={g.hideFromCapture} onChange={(v) => api.setGeneral({ hideFromCapture: v })} />
      </Row>

      <div className="set-title set-title-sub">Updates</div>
      <UpdateRow updater={updater} />

      <div className="set-foot">
        <span className="set-note">{version ? `Island ${version}` : "Island"}</span>
        <button className="text-btn" onClick={onRerunSetup}>
          Run setup again
        </button>
      </div>
    </>
  );
}
