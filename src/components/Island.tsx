import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { livePosition, useMedia, type MediaState } from "../hooks/useMedia";
import { currentLineIndex, useLyrics, type Lyrics } from "../hooks/useLyrics";
import { usePrayer } from "../hooks/usePrayer";
import { usePrayerReminder } from "../hooks/usePrayerReminder";
import { useWeather } from "../hooks/useWeather";
import { usePomodoro } from "../hooks/usePomodoro";
import { useNow } from "../hooks/useNow";
import { useHitRect } from "../hooks/useHitRect";
import { useLocation, type Place } from "../hooks/useLocation";
import { useTodos } from "../hooks/useTodos";
import { useNotes } from "../hooks/useNotes";
import { TodoView } from "./TodoView";
import { NotesBoard } from "./NotesBoard";
import { useSystem, type RadioKind } from "../hooks/useSystem";
import { SystemControls, SystemPanel, type Panel } from "./SystemControls";
import { useSettings } from "../hooks/useSettings";
import { FocusSettingsPanel, GeneralPanel, PrayerSettingsPanel, WellnessSettingsPanel } from "./Settings";
import { useWellness } from "../hooks/useWellness";
import { useUpdater } from "../hooks/useUpdater";
import { DropGlyph, StandGlyph, WellnessStrip } from "./WellnessView";
import { Welcome } from "./Welcome";
import { useGlass } from "../hooks/useGlass";
import { useTilt } from "../hooks/useTilt";
import { setUse24h } from "../lib/format";
import { readDrop, useShelf, type FileItem } from "../hooks/useShelf";
import { useHud, type Hud } from "../hooks/useHud";
import { useTasbih } from "../hooks/useTasbih";
import { ShelfView } from "./ShelfView";
import { TasbihView } from "./TasbihView";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SpeakerIcon, SunIcon } from "./SystemIcons";
import { clock, mmss, until } from "../lib/format";
import { Bars, NextIcon, PauseIcon, PlayIcon, PrevIcon, ResetIcon, SkipIcon } from "./Icons";

/** Collapse this long after the cursor leaves, so brushing past doesn't flicker. */
const COLLAPSE_DELAY = 350;

type Peek = "pomodoro-done" | "hud" | "color" | "capture" | "prayer" | "update" | "wellness" | "pomodoro" | "media" | "idle";
export type Tab = "now" | "today" | "notes" | "shelf" | "tasbih";

/** How long the brief previews stay in the collapsed island. */
const HUD_MS = 1600;
const COLOR_MS = 2600;
const CAPTURE_MS = 6000;
const UPDATE_MS = 10_000;

export function Island() {
  const now = useNow(250);
  const { media, control } = useMedia();
  const lyrics = useLyrics(media);
  const settingsApi = useSettings();
  const { settings, onboarded, setOnboarded } = settingsApi;
  setUse24h(settings.general.use24h);
  const place = useLocation(settings.location);
  const prayer = usePrayer(now, place, settings.prayer);
  usePrayerReminder(prayer, settings.prayer.notify);
  const weather = useWeather(place);
  const pomo = usePomodoro(now, settings.pomodoro);
  const todos = useTodos(now);
  const notes = useNotes();
  const shelf = useShelf();
  const hud = useHud();
  const tasbih = useTasbih();
  const wellness = useWellness(now, settings.wellness, !!prayer.alert);
  const updater = useUpdater();

  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>("now");
  const [dragging, setDragging] = useState(false);
  /** Something is being dragged over the island from another app. */
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [searching, setSearching] = useState<Record<RadioKind, boolean>>({ wifi: false, bluetooth: false });
  const sys = useSystem(expanded && tab === "now");
  const leaveTimer = useRef<number>();
  const hovering = useRef(false);
  const held = useRef(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Prayer / focus settings popover, anchored under the widget that opened it. */
  type PopKind = "prayer" | "focus" | "general" | "wellness";
  const [settingsPop, setSettingsPop] = useState<{ kind: PopKind; top: number; left: number; arrow: number } | null>(null);
  /** First launch: the welcome screen keeps the island open until it's done. */
  const welcoming = !onboarded;
  const welcomingRef = useRef(welcoming);
  welcomingRef.current = welcoming;
  const popoverOpen = !!panel || !!settingsPop;
  const popoverRef = useRef(false);
  popoverRef.current = popoverOpen;
  // While dragging a note or a popover is open, take the mouse over the whole
  // window: drags aren't cut off at the pill's edge, popovers can sit outside
  // it, and a click anywhere else closes the popover like a normal one.
  useHitRect(pillRef, dragging || popoverOpen);

  /** Typing in a to-do or note keeps the island open even if the mouse wanders off. */
  const isTyping = () => {
    const a = document.activeElement;
    return !!a && !!pillRef.current?.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
  };
  const scheduleCollapse = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      if (!hovering.current && !held.current && !popoverRef.current && !welcomingRef.current && !isTyping()) setExpanded(false);
    }, COLLAPSE_DELAY);
  }, []);

  useEffect(() => {
    // Clicking another app: stop editing and fold away.
    const onBlur = () => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      // Clicking another app closes popovers, like any normal popover.
      setPanel(null);
      setSettingsPop(null);
      popoverRef.current = false;
      scheduleCollapse();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // First Esc closes an open popover, the next folds the island.
      if (popoverRef.current) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        setPanel(null);
        setSettingsPop(null);
      } else if (!isTyping()) {
        hovering.current = false;
        setExpanded(false);
      }
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(leaveTimer.current);
    };
  }, [scheduleCollapse]);

  // Popovers close when the island folds or you switch tabs.
  useEffect(() => {
    setPanel(null);
    setSettingsPop(null);
  }, [expanded, tab]);

  // A water / stand reminder is waiting: opening the island goes straight to
  // the Today tab where you can tick it off (once per reminder).
  const wellKey = wellness.showing ? `${wellness.pending.water}|${wellness.pending.stand}` : "";
  const wellSwitched = useRef("");
  useEffect(() => {
    if (expanded && wellKey && wellSwitched.current !== wellKey && !welcoming) {
      wellSwitched.current = wellKey;
      setTab("today");
    }
  }, [expanded, wellKey, welcoming]);
  const onSearching = useCallback((kind: RadioKind, on: boolean) => setSearching((s) => ({ ...s, [kind]: on })), []);

  /** Close whatever popover is open (backdrop click). Fold too if the mouse already left. */
  const closePopovers = useCallback(() => {
    setPanel(null);
    setSettingsPop(null);
    popoverRef.current = false;
    if (!hovering.current) scheduleCollapse();
  }, [scheduleCollapse]);

  // Only one popover at a time.
  const openPanel = useCallback((p: Panel) => {
    setSettingsPop(null);
    setPanel(p);
  }, []);
  const openSettings = useCallback((kind: PopKind, el: HTMLElement) => {
    setPanel(null);
    setSettingsPop((cur) => {
      if (cur?.kind === kind) return null; // second click closes it
      const wrap = wrapRef.current!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const W = 300;
      const anchorX = r.left - wrap.left + 28;
      const left = Math.min(wrap.width - W + 20, Math.max(-20, anchorX - 40));
      return { kind, top: r.bottom - wrap.top + 10, left, arrow: anchorX - left };
    });
  }, []);

  // Fold the island out of the way, then open the colour picker.
  const startPicker = useCallback(() => {
    hovering.current = false;
    setExpanded(false);
    window.setTimeout(() => invoke("picker_open").catch(console.warn), 200);
  }, []);

  /* Drag & drop from other apps onto the island → Clips. */
  const isExternal = (e: React.DragEvent) => Array.from(e.dataTransfer.types).some((t) => t === "Files" || t.startsWith("text/"));
  const onDragEnter = (e: React.DragEvent) => {
    if (!isExternal(e) || held.current) return;
    e.preventDefault();
    dragDepth.current += 1;
    hovering.current = true;
    window.clearTimeout(leaveTimer.current);
    setExpanded(true);
    setTab("shelf");
    setDropping(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!dropping) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDropping(false);
      hovering.current = false;
      scheduleCollapse();
    }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!dropping) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDropping(false);
    shelf.addIncoming(readDrop(e.dataTransfer));
  };

  // Fold the island out of the way, then open Snipping Tool's recorder.
  const startRecording = useCallback(() => {
    hovering.current = false;
    setPanel(null);
    setExpanded(false);
    window.setTimeout(() => invoke("start_screen_record").catch(console.warn), 220);
  }, []);

  // Keep the island out of screenshots and recordings (a setting).
  useEffect(() => {
    invoke("set_capture_hidden", { hidden: settings.general.hideFromCapture }).catch(() => {});
  }, [settings.general.hideFromCapture]);

  // Welcome screen: open the island and keep it open.
  useEffect(() => {
    if (welcoming) setExpanded(true);
  }, [welcoming]);
  const rerunSetup = useCallback(() => {
    setPanel(null);
    setSettingsPop(null);
    setTab("now");
    setOnboarded(false);
  }, [setOnboarded]);

  // Liquid glass + 3D tilt.
  const glassActive = useGlass(wrapRef, settings.general.glass);
  useTilt(pillRef, settings.general.tilt && !dragging && !popoverOpen && !welcoming, expanded ? 1.4 : 5);

  const onEnter = () => {
    hovering.current = true;
    window.clearTimeout(leaveTimer.current);
    setExpanded(true);
  };
  const onLeave = () => {
    hovering.current = false;
    scheduleCollapse();
  };
  const onHold = useCallback(
    (h: boolean) => {
      held.current = h;
      setDragging(h);
      if (!h && !hovering.current) scheduleCollapse();
    },
    [scheduleCollapse],
  );

  // Brief previews (only while folded).
  const hudShown: Hud | null = !expanded && hud && now - hud.at < HUD_MS ? hud : null;
  const colorShown = !expanded && shelf.lastColor && now - shelf.lastColor.at < COLOR_MS ? shelf.lastColor.hex : null;
  const captureShown = !expanded && shelf.lastCapture && now - shelf.lastCapture.at < CAPTURE_MS ? shelf.lastCapture.item : null;
  const updateShown = !expanded && updater.status.kind === "available" && now - updater.status.at < UPDATE_MS ? updater.status.version : null;

  // What the collapsed pill shows, highest priority first.
  const peek: Peek = pomo.justFinished
    ? "pomodoro-done"
    : hudShown
      ? "hud"
      : colorShown
        ? "color"
        : captureShown
          ? "capture"
          : prayer.alert
      ? "prayer"
      : updateShown
        ? "update"
      : wellness.showing
        ? "wellness"
      : pomo.running
        ? "pomodoro"
        : media?.playing
          ? "media"
          : "idle";

  const position = media ? livePosition(media, now) : 0;

  // Collapsed width follows its content (measured), within sensible bounds.
  const [restWidth, setRestWidth] = useState(210);
  const onRestWidth = useCallback((w: number) => setRestWidth(Math.round(Math.min(460, Math.max(150, w)))), []);

  const className = [
    "pill",
    expanded ? `is-expanded tab-${welcoming ? "welcome" : tab}` : `peek-${peek}`,
    glassActive ? "is-glass" : "",
    expanded && media ? "has-media" : "",
  ].join(" ");

  return (
    <div className="stage">
      {/* Invisible layer behind an open popover: clicking it closes the popover. */}
      {popoverOpen && <div className="popover-backdrop" onPointerDown={closePopovers} />}
      <div
        ref={wrapRef}
        className="island-wrap"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onBlur={() => window.setTimeout(scheduleCollapse, 0)}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
      <div ref={pillRef} className={className} style={expanded ? undefined : { width: restWidth }}>
        <div className="tilt-layer">
        {expanded && welcoming ? (
          <div className="expanded-shell fade-in">
            <Welcome api={settingsApi} place={place} today={prayer.today} onDone={() => setOnboarded(true)} />
          </div>
        ) : expanded ? (
          <div
            className="expanded-shell fade-in"
            onPointerDown={(e) => {
              // Tapping elsewhere in the island closes an open popover.
              const t = e.target as HTMLElement;
              if (popoverOpen && !t.closest(".sys, .widget-clickable")) {
                setPanel(null);
                setSettingsPop(null);
              }
            }}
          >
            <div className="shell-head">
              <Tabs
                tab={tab}
                setTab={setTab}
                remaining={todos.remaining}
                noteCount={notes.notes.length}
                clipCount={shelf.clips.length}
              />
              {tab === "now" && (
                <SystemControls
                  sys={sys}
                  panel={panel}
                  setPanel={openPanel}
                  searching={searching}
                  onHold={onHold}
                  onRecord={startRecording}
                />
              )}
            </div>
            {tab === "now" && (
              <Expanded
                media={media}
                position={position}
                lyrics={lyrics}
                control={control}
                now={now}
                place={place}
                prayer={prayer}
                weather={weather}
                pomo={pomo}
                settingsOpen={settingsPop?.kind ?? null}
                onOpenSettings={openSettings}
                onTasbih={() => setTab("tasbih")}
              />
            )}
            {tab === "today" && (
              <div className="today">
                <WellnessStrip
                  w={wellness}
                  s={settings.wellness}
                  now={now}
                  settingsOpen={settingsPop?.kind === "wellness"}
                  onOpenSettings={(el) => openSettings("wellness", el)}
                />
                <TodoView todos={todos} />
              </div>
            )}
            {tab === "notes" && <NotesBoard notes={notes} onHold={onHold} />}
            {tab === "shelf" && <ShelfView shelf={shelf} dropping={dropping} onPick={startPicker} />}
            {tab === "tasbih" && <TasbihView t={tasbih} />}
          </div>
        ) : (
          <Collapsed
            peek={peek}
            media={media}
            lyrics={lyrics}
            position={position}
            now={now}
            prayer={prayer}
            pomo={pomo}
            todoCount={todos.remaining}
            noteCount={notes.notes.length}
            clipCount={shelf.clips.length}
            hud={hudShown}
            color={colorShown}
            capture={captureShown}
            update={updateShown}
            wellness={wellness}
            waterGoal={settings.wellness.waterGoal}
            onWidth={onRestWidth}
          />
        )}
        </div>
      </div>

      {/* Popovers float over/below the island instead of stretching it. */}
      {expanded && tab === "now" && panel && (
        <SystemPanel panel={panel} radioOn={sys.radios[panel]} onSearching={onSearching} />
      )}
      {expanded && settingsPop && (tab === "now" || settingsPop.kind === "wellness") && (
        <div
          className="popover set-popover"
          role="dialog"
          aria-label={
            settingsPop.kind === "prayer"
              ? "Prayer settings"
              : settingsPop.kind === "focus"
                ? "Focus timer settings"
                : settingsPop.kind === "wellness"
                  ? "Reminder settings"
                  : "Settings"
          }
          style={{
            top: settingsPop.top,
            left: settingsPop.left,
            maxHeight: `calc(100vh - ${settingsPop.top + 12}px)`,
            ["--arrow" as string]: `${settingsPop.arrow}px`,
          }}
        >
          {settingsPop.kind === "prayer" ? (
            <PrayerSettingsPanel api={settingsApi} today={prayer.today} />
          ) : settingsPop.kind === "focus" ? (
            <FocusSettingsPanel api={settingsApi} running={pomo.running} />
          ) : settingsPop.kind === "wellness" ? (
            <WellnessSettingsPanel api={settingsApi} />
          ) : (
            <GeneralPanel api={settingsApi} place={place} updater={updater} onRerunSetup={rerunSetup} />
          )}
        </div>
      )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- collapsed */

function Collapsed({
  peek,
  media,
  lyrics,
  position,
  now,
  prayer,
  pomo,
  todoCount,
  noteCount,
  clipCount,
  hud,
  color,
  capture,
  update,
  wellness,
  waterGoal,
  onWidth,
}: {
  peek: Peek;
  media: MediaState | null;
  lyrics: Lyrics;
  position: number;
  now: number;
  prayer: ReturnType<typeof usePrayer>;
  pomo: ReturnType<typeof usePomodoro>;
  todoCount: number;
  noteCount: number;
  clipCount: number;
  hud: Hud | null;
  color: string | null;
  capture: FileItem | null;
  update: string | null;
  wellness: ReturnType<typeof useWellness>;
  waterGoal: number;
  onWidth: (w: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const a = prayer.alert;
  const timerOn = pomo.running;
  const done = peek === "pomodoro-done";
  const rowKey = ["hud", "color", "capture", "update", "wellness"].includes(peek)
    ? peek
    : done
      ? "done"
      : a
        ? "prayer"
        : timerOn
          ? "timer"
          : media?.playing
            ? "media"
            : "idle";

  // The pill sizes itself to whatever it's showing. Re-attach when the row is
  // swapped for a different state.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => onWidth(el.offsetWidth));
    ro.observe(el);
    onWidth(el.offsetWidth);
    return () => ro.disconnect();
  }, [onWidth, rowKey]);

  // Brief previews take over the whole pill.
  if (peek === "hud" && hud) {
    const muted = hud.kind === "volume" && hud.muted;
    return (
      <div ref={rowRef} className="row peek peek-hud fade-in" key="hud">
        <span className="hud-icon">
          {hud.kind === "volume" ? <SpeakerIcon level={hud.value / 100} muted={muted || hud.value === 0} /> : <SunIcon />}
        </span>
        <span className="hud-bar" aria-hidden>
          <span className="hud-fill" style={{ width: `${muted ? 0 : hud.value}%` }} />
        </span>
        <span className="hud-value tabular">{muted ? "Muted" : hud.value}</span>
      </div>
    );
  }
  if (peek === "color" && color) {
    return (
      <div ref={rowRef} className="row peek fade-in" key="color">
        <span className="peek-swatch" style={{ background: color }} />
        <span className="peek-main tabular">{color}</span>
        <span className="peek-sub">copied</span>
      </div>
    );
  }
  if (peek === "capture" && capture) {
    const video = capture.kind === "video";
    return (
      <div ref={rowRef} className="row peek fade-in" key="capture">
        <span className="mini-stack" aria-hidden>
          <span className="mini-card mini-card-back" />
          <span className="mini-card mini-card-mid" />
          <span className="mini-card">
            {video ? <video src={`${fileSrc(capture.path)}#t=0.1`} muted preload="metadata" /> : <img src={fileSrc(capture.path)} alt="" />}
          </span>
        </span>
        <span className="peek-main">{video ? "Recording saved" : "Screenshot saved"}</span>
        <span className="peek-sub">in Shelf</span>
      </div>
    );
  }

  if (peek === "update" && update) {
    return (
      <div ref={rowRef} className="row peek fade-in" key="update">
        <span className="dot dot-blue pulse" />
        <span className="peek-main">Island {update} is ready</span>
        <span className="peek-sub">install from the clock</span>
      </div>
    );
  }

  let lead;
  if (peek === "wellness") {
    const both = wellness.pending.water && wellness.pending.stand;
    lead = (
      <>
        <span className="peek-well-icon pulse-soft" aria-hidden>
          {wellness.pending.water ? <DropGlyph size={13} /> : <StandGlyph size={13} />}
        </span>
        <span className="peek-main peek-blue">
          {both ? "Stand up & drink water" : wellness.pending.water ? "Time for some water" : "Time to stand up"}
        </span>
        {!both && wellness.pending.water && (
          <span className="peek-sub tabular">
            {wellness.water.count + 1} of {waterGoal}
          </span>
        )}
      </>
    );
  } else if (done) {
    lead = (
      <>
        <span className="dot dot-gold pulse" />
        <span className="peek-main">{pomo.mode === "break" ? "Focus done · take a break" : "Break over · back to it"}</span>
      </>
    );
  } else if (a) {
    lead = (
      <>
        <span className="dot dot-gold pulse" />
        <span className="peek-main peek-gold">{a.prayer.label}</span>
      </>
    );
  } else if (timerOn) {
    lead = (
      <>
        {pomo.mode === "focus" && <span className="rec-dot" aria-hidden />}
        <span className="peek-main">{pomo.mode === "focus" ? "Focus" : "Break"}</span>
      </>
    );
  } else if (media?.playing) {
    const line = currentLyric(lyrics, position);
    lead = (
      <>
        {media.artwork ? <img className="art art-sm" src={media.artwork} alt="" /> : <span className="art art-sm" />}
        <span className="peek-main ellipsis peek-track" key={line ?? media.title}>
          {line ?? media.title}
        </span>
        <Bars playing />
      </>
    );
  } else {
    lead = (
      <>
        <span className="peek-main tabular">{clock(new Date(now))}</span>
        <span className="peek-sub">
          {prayer.next.label} {clock(prayer.next.time)}
        </span>
      </>
    );
  }

  return (
    <div ref={rowRef} className="row peek fade-in" key={rowKey}>
      {lead}
      {!done && a && (
        <span className="countdown countdown-prayer tabular" aria-label={`${a.prayer.label} countdown`}>
          {a.kind === "now" ? "now" : mmss(prayer.msUntilNext)}
        </span>
      )}
      {!done && a && timerOn && <span className="peek-divider" aria-hidden />}
      {!done && timerOn && (
        <span className="countdown countdown-timer tabular" aria-label="Timer countdown">
          <Ring progress={pomo.progress} />
          {mmss(pomo.remainingMs)}
        </span>
      )}
      {(todoCount > 0 || noteCount > 0 || clipCount > 0) && (
        <span className="peek-badges">
          {todoCount > 0 && (
            <span className="peek-badge" title={`${todoCount} to-do${todoCount > 1 ? "s" : ""} left`}>
              <TodoGlyph />
              {todoCount}
            </span>
          )}
          {noteCount > 0 && (
            <span className="peek-badge" title={`${noteCount} note${noteCount > 1 ? "s" : ""}`}>
              <NoteGlyph />
              {noteCount}
            </span>
          )}
          {clipCount > 0 && (
            <span className="peek-badge" title={`${clipCount} clip${clipCount > 1 ? "s" : ""} on the shelf`}>
              <ClipGlyph />
              {clipCount}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

const fileSrc = (p: string) => {
  try {
    return convertFileSrc(p);
  } catch {
    return p;
  }
};
const ClipGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="6" width="13" height="14" rx="2.5" />
    <path d="M8 3.5h9.5A2.5 2.5 0 0 1 20 6v11" />
  </svg>
);
const TodoGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.8 2.8L16.5 9.5" />
  </svg>
);
const NoteGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5V14l-6 6H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M14 20v-4.5a1.5 1.5 0 0 1 1.5-1.5H20" />
  </svg>
);

/* --------------------------------------------------------------------- tabs */

function Tabs({
  tab,
  setTab,
  remaining,
  noteCount,
  clipCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  remaining: number;
  noteCount: number;
  clipCount: number;
}) {
  const items: { id: Tab; label: string; badge?: number }[] = [
    { id: "now", label: "Now" },
    { id: "today", label: "Today", badge: remaining || undefined },
    { id: "notes", label: "Notes", badge: noteCount || undefined },
    { id: "shelf", label: "Shelf", badge: clipCount || undefined },
    { id: "tasbih", label: "Tasbih" },
  ];
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          className={`tab ${tab === t.id ? "is-active" : ""}`}
          onClick={() => setTab(t.id)}
        >
          {t.label}
          {t.badge !== undefined && <span className="tab-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- expanded */

function Expanded({
  media,
  position,
  lyrics,
  control,
  now,
  place,
  prayer,
  weather,
  pomo,
  settingsOpen,
  onOpenSettings,
  onTasbih,
}: {
  media: MediaState | null;
  position: number;
  lyrics: Lyrics;
  control: ReturnType<typeof useMedia>["control"];
  now: number;
  place: Place;
  prayer: ReturnType<typeof usePrayer>;
  weather: ReturnType<typeof useWeather>;
  pomo: ReturnType<typeof usePomodoro>;
  settingsOpen: string | null;
  onOpenSettings: (kind: "prayer" | "focus" | "general", el: HTMLElement) => void;
  onTasbih: () => void;
}) {
  return (
    <div className="expanded">
      {media && (
        <section className="media">
          <div className="media-top">
            {media.artwork ? <img className="art art-lg" src={media.artwork} alt="" /> : <span className="art art-lg" />}
            <div className="media-meta">
              <div className="title ellipsis">{media.title}</div>
              <div className="artist ellipsis">
                {media.artist || "Unknown artist"}
              </div>
              {media.durationMs > 0 && (
                <div className="progress">
                  <span className="tabular muted">{mmss(position)}</span>
                  <div className="track">
                    <div className="fill" style={{ width: `${(position / media.durationMs) * 100}%` }} />
                  </div>
                  <span className="tabular muted">{mmss(media.durationMs)}</span>
                </div>
              )}
            </div>
            <div className="controls">
              <button className="icon-btn" onClick={() => control("previous")} aria-label="Previous">
                <PrevIcon />
              </button>
              <button className="icon-btn icon-btn-main" onClick={() => control("toggle")} aria-label={media.playing ? "Pause" : "Play"}>
                {media.playing ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button className="icon-btn" onClick={() => control("next")} aria-label="Next">
                <NextIcon />
              </button>
            </div>
          </div>
          <LyricsView lyrics={lyrics} position={position} />
        </section>
      )}

      <section className="widgets">
        <Clickable label="Location and settings" open={settingsOpen === "general"} onOpen={(el) => onOpenSettings("general", el)}>
          <div className="widget">
            <div className="widget-label ellipsis" title={place.name}>{place.name}</div>
            <div className="widget-value tabular">{clock(new Date(now))}</div>
            <div className="widget-sub">{weather ? `${weather.tempC}° · ${weather.label}` : "—"}</div>
          </div>
        </Clickable>

        <Clickable label="Prayer settings" open={settingsOpen === "prayer"} onOpen={(el) => onOpenSettings("prayer", el)}>
          <PrayerWidget prayer={prayer} onTasbih={onTasbih} />
        </Clickable>

        <Clickable label="Focus timer settings" open={settingsOpen === "focus"} onOpen={(el) => onOpenSettings("focus", el)}>
        <div className="widget widget-pomo">
          <div className="widget-label row-inline">
            {pomo.running && pomo.mode === "focus" && <span className="rec-dot" aria-label="Focus running" />}
            {pomo.mode === "focus" ? "Focus" : "Break"}
          </div>
          <div className="widget-value tabular">{mmss(pomo.remainingMs)}</div>
          <div className="pomo-actions">
            <button className="chip" onClick={pomo.running ? pomo.pause : pomo.start}>
              {pomo.running ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="chip" onClick={pomo.reset} aria-label="Reset">
              <ResetIcon />
            </button>
            <button className="chip" onClick={pomo.skip} aria-label="Skip">
              <SkipIcon />
            </button>
          </div>
        </div>
        </Clickable>
      </section>
    </div>
  );
}

/** Makes a widget open its settings popover on click (its own buttons still work). */
function Clickable({
  label,
  open,
  onOpen,
  children,
}: {
  label: string;
  open: boolean;
  onOpen: (el: HTMLElement) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`widget-clickable ${open ? "is-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-expanded={open}
      title={label}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onOpen(e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(e.currentTarget);
        }
      }}
    >
      {children}
      <span className="widget-gear" aria-hidden>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      </span>
    </div>
  );
}

/** Next prayer. Lights up gold during the reminder window (5 min; 30 min for Jumu'ah). */
function PrayerWidget({ prayer, onTasbih }: { prayer: ReturnType<typeof usePrayer>; onTasbih: () => void }) {
  const a = prayer.alert;
  if (a?.kind === "now") {
    return (
      <div className="widget is-prayer-alert">
        <div className="widget-label row-inline">
          <span className="prayer-dot" aria-hidden />
          Prayer time
        </div>
        <div className="widget-value">
          {a.prayer.label} <span className="tabular">{clock(a.prayer.time)}</span>
        </div>
        <div className="widget-sub">started · next {prayer.next.label} {clock(prayer.next.time)}</div>
        <button className="chip chip-label" onClick={onTasbih}>
          Tasbih after prayer
        </button>
      </div>
    );
  }
  const soon = a?.kind === "soon";
  const jumuah = prayer.next.label === "Jumu'ah";
  return (
    <div className={`widget ${soon ? "is-prayer-alert" : ""}`}>
      <div className="widget-label row-inline">
        {soon && <span className="prayer-dot" aria-hidden />}
        {soon ? (jumuah ? "Get ready" : "Starting soon") : "Next prayer"}
      </div>
      <div className="widget-value">
        {prayer.next.label} <span className="tabular">{clock(prayer.next.time)}</span>
      </div>
      <div className="widget-sub tabular">{until(prayer.msUntilNext)}</div>
      {soon && (
        <div className="prayer-countdown" aria-hidden>
          <div
            className="prayer-countdown-fill"
            style={{ width: `${Math.min(100, (1 - prayer.msUntilNext / (prayer.next.leadMinutes * 60_000)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function LyricsView({ lyrics, position }: { lyrics: Lyrics; position: number }) {
  if (lyrics.status === "synced") {
    const i = currentLineIndex(lyrics.lines, position);
    const cur = lyrics.lines[i]?.text || (i < 0 ? "" : "♪");
    const next = lyrics.lines[i + 1]?.text ?? "";
    return (
      <div className="lyrics">
        <div className="lyric-current" key={`c${i}`}>{cur || "♪"}</div>
        <div className="lyric-next" key={`n${i}`}>{next}</div>
      </div>
    );
  }
  const msg =
    lyrics.status === "loading"
      ? "Finding lyrics…"
      : lyrics.status === "instrumental"
        ? "Instrumental"
        : lyrics.status === "plain"
          ? "Lyrics found, but not time-synced"
          : "No lyrics for this track";
  return (
    <div className="lyrics">
      <div className="lyric-next">{msg}</div>
    </div>
  );
}

function currentLyric(lyrics: Lyrics, position: number): string | null {
  if (lyrics.status !== "synced") return null;
  const line = lyrics.lines[currentLineIndex(lyrics.lines, position)];
  return line?.text || null;
}

function Ring({ progress }: { progress: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r={r} className="ring-bg" />
      <circle cx="9" cy="9" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
    </svg>
  );
}
