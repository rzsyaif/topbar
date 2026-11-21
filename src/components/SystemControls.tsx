import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openSettings, type BtDevice, type RadioKind, type WifiNetwork, type useSystem } from "../hooks/useSystem";
import { CheckIcon } from "./Icons";
import {
  ArrowIcon,
  BluetoothIcon,
  DeviceIcon,
  GearIcon,
  RecordIcon,
  LockIcon,
  RefreshIcon,
  SignalIcon,
  SpeakerIcon,
  SunIcon,
  WifiIcon,
} from "./SystemIcons";

type System = ReturnType<typeof useSystem>;
export type Panel = RadioKind | null;

const HOLD_MS = 420;
/** Pixels of vertical drag for a full 0→100% sweep. */
const DRAG_RANGE = 110;
const WHEEL_STEP = 0.04;

/* ------------------------------------------------------------- the row */

export function SystemControls({
  sys,
  panel,
  setPanel,
  searching,
  onHold,
  onRecord,
}: {
  sys: System;
  panel: Panel;
  setPanel: (p: Panel) => void;
  searching: Record<RadioKind, boolean>;
  onHold: (held: boolean) => void;
  onRecord: () => void;
}) {
  const vol = sys.volume;
  return (
    <div className="sys">
      <RadioButton
        label="Wi-Fi"
        on={sys.radios.wifi}
        searching={sys.busy.wifi || searching.wifi}
        open={panel === "wifi"}
        onToggle={() => sys.toggleRadio("wifi")}
        onHoldOpen={() => setPanel(panel === "wifi" ? null : "wifi")}
      >
        <WifiIcon />
      </RadioButton>
      <RadioButton
        label="Bluetooth"
        on={sys.radios.bluetooth}
        searching={sys.busy.bluetooth || searching.bluetooth}
        open={panel === "bluetooth"}
        onToggle={() => sys.toggleRadio("bluetooth")}
        onHoldOpen={() => setPanel(panel === "bluetooth" ? null : "bluetooth")}
      >
        <BluetoothIcon />
      </RadioButton>
      <LevelKnob
        label="Volume"
        value={vol ? (vol.muted ? 0 : vol.level) : null}
        dimmed={!!vol?.muted}
        onChange={sys.setVolume}
        onTap={sys.toggleMute}
        onHold={onHold}
      >
        <SpeakerIcon level={vol?.level ?? 0} muted={!!vol?.muted || vol?.level === 0} />
      </LevelKnob>
      <LevelKnob
        label="Brightness"
        value={typeof sys.brightness === "number" ? sys.brightness / 100 : null}
        unavailable={sys.brightness === null}
        onChange={(v) => sys.setBrightness(v * 100)}
        onHold={onHold}
      >
        <SunIcon />
      </LevelKnob>
      <RecordButton onRecord={onRecord} />
    </div>
  );
}

/* ------------------------------------------------------------ screen record */

/** Tap: Snipping Tool's recording overlay. Hold: open the recordings folder. */
function RecordButton({ onRecord }: { onRecord: () => void }) {
  const timer = useRef<number>();
  const held = useRef(false);
  const [pressing, setPressing] = useState(false);

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    held.current = false;
    setPressing(true);
    timer.current = window.setTimeout(() => {
      held.current = true;
      setPressing(false);
      invoke("open_recordings").catch(console.warn);
    }, HOLD_MS);
  };
  const up = () => {
    window.clearTimeout(timer.current);
    setPressing(false);
    if (!held.current) onRecord();
    held.current = false;
  };

  return (
    <button
      className={`sys-btn sys-record ${pressing ? "is-pressing" : ""}`}
      aria-label="Record screen. Hold to open recordings folder"
      title="Record screen"
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={() => {
        window.clearTimeout(timer.current);
        setPressing(false);
      }}
    >
      <RecordIcon />
    </button>
  );
}

/* ---------------------------------------------------- Wi-Fi / Bluetooth */

/** Tap toggles the radio; press and hold opens its list. */
function RadioButton({
  label,
  on,
  searching,
  open,
  onToggle,
  onHoldOpen,
  children,
}: {
  label: string;
  on: boolean | null;
  searching: boolean;
  open: boolean;
  onToggle: () => void;
  onHoldOpen: () => void;
  children: ReactNode;
}) {
  const timer = useRef<number>();
  const held = useRef(false);
  const [pressing, setPressing] = useState(false);
  const missing = on === null;

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    held.current = false;
    setPressing(true);
    timer.current = window.setTimeout(() => {
      held.current = true;
      setPressing(false);
      onHoldOpen();
    }, HOLD_MS);
  };
  const up = () => {
    window.clearTimeout(timer.current);
    setPressing(false);
    if (!held.current && !missing) onToggle();
    held.current = false;
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    setPressing(false);
  };

  return (
    <button
      className={[
        "sys-btn",
        on ? "is-on" : "",
        searching ? "is-searching" : "",
        pressing ? "is-pressing" : "",
        open ? "is-open" : "",
        missing ? "is-missing" : "",
      ].join(" ")}
      aria-label={`${label}: ${missing ? "not available" : on ? "on" : "off"}. Hold to show list`}
      aria-pressed={!!on}
      title={label}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={cancel}
      onContextMenu={(e) => {
        e.preventDefault();
        onHoldOpen();
      }}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------- Volume / Brightness */

/** Drag up/down or scroll over it to change. White fills from the bottom. */
function LevelKnob({
  label,
  value,
  dimmed,
  unavailable,
  onChange,
  onTap,
  onHold,
  children,
}: {
  label: string;
  value: number | null;
  dimmed?: boolean;
  unavailable?: boolean;
  onChange: (v: number) => void;
  onTap?: () => void;
  onHold: (held: boolean) => void;
  children: ReactNode;
}) {
  const drag = useRef<{ y: number; v: number; moved: boolean } | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const settle = useRef<number>();
  const disabled = unavailable || value === null;

  const pulse = () => {
    setAdjusting(true);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setAdjusting(false), 500);
  };

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value!, moved: false };
    setAdjusting(true);
    onHold(true);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) > 3) d.moved = true;
    if (d.moved) onChange(Math.min(1, Math.max(0, d.v + dy / DRAG_RANGE)));
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    onHold(false);
    pulse();
    if (!d.moved) onTap?.();
  };
  const wheel = (e: WheelEvent) => {
    if (disabled) return;
    onChange(Math.min(1, Math.max(0, value! + (e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP))));
    pulse();
  };

  const pct = value === null ? 0 : Math.round(value * 100);
  return (
    <button
      className={["sys-btn", "sys-knob", adjusting ? "is-adjusting" : "", dimmed ? "is-dimmed" : "", disabled ? "is-missing" : ""].join(" ")}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-disabled={disabled}
      title={unavailable ? `${label} isn't adjustable on this display` : label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onWheel={wheel}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(Math.min(1, value! + WHEEL_STEP));
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(Math.max(0, value! - WHEEL_STEP));
      }}
    >
      <span className="sys-fill" style={{ height: `${pct}%` }} />
      <span className="sys-icon">{children}</span>
    </button>
  );
}

/* --------------------------------------------------------- the lists */

export function SystemPanel({
  panel,
  radioOn,
  onSearching,
}: {
  panel: RadioKind;
  radioOn: boolean | null;
  onSearching: (kind: RadioKind, on: boolean) => void;
}) {
  // Esc is handled by the island: it closes this list first, then folds.
  return (
    <div className="sys-panel" role="dialog" aria-label={panel === "wifi" ? "Wi-Fi networks" : "Bluetooth devices"}>
      {panel === "wifi" ? (
        <WifiList radioOn={radioOn} onSearching={(s) => onSearching("wifi", s)} />
      ) : (
        <BtList radioOn={radioOn} onSearching={(s) => onSearching("bluetooth", s)} />
      )}
    </div>
  );
}

function PanelHead({ icon, onRefresh, settings }: { icon: ReactNode; onRefresh?: () => void; settings: "wifi" | "bluetooth" }) {
  return (
    <div className="sys-panel-head">
      <span className="sys-panel-glyph">{icon}</span>
      <span className="sys-panel-actions">
        {onRefresh && (
          <button className="icon-chip" onClick={onRefresh} aria-label="Refresh" title="Refresh">
            <RefreshIcon />
          </button>
        )}
        <button className="icon-chip" onClick={() => openSettings(settings)} aria-label="Open settings" title="Settings">
          <GearIcon />
        </button>
      </span>
    </div>
  );
}

function WifiList({ radioOn, onSearching }: { radioOn: boolean | null; onSearching: (s: boolean) => void }) {
  const [nets, setNets] = useState<WifiNetwork[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [askFor, setAskFor] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const load = async (scan: boolean) => {
    setScanning(true);
    onSearching(true);
    try {
      setNets(await invoke<WifiNetwork[]>("wifi_networks", { scan }));
    } catch (e) {
      console.warn(e);
      setNets((n) => n ?? []);
    } finally {
      setScanning(false);
      onSearching(false);
    }
  };

  useEffect(() => {
    if (!radioOn) return;
    // Show what Windows already knows instantly, then do a fresh scan.
    load(false).then(() => load(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radioOn]);

  const connect = async (ssid: string, pw?: string) => {
    setConnecting(ssid);
    setFailed(null);
    onSearching(true);
    try {
      const r = await invoke<string>("wifi_connect", { ssid, password: pw ?? null });
      if (r === "connected") {
        setAskFor(null);
        setPassword("");
        await load(false);
      } else if (r === "needs_password") {
        if (pw) setFailed(ssid);
        setAskFor(ssid);
      } else setFailed(ssid);
    } catch {
      setFailed(ssid);
    } finally {
      setConnecting(null);
      onSearching(false);
    }
  };

  return (
    <>
      <PanelHead icon={<WifiIcon />} onRefresh={radioOn ? () => load(true) : undefined} settings="wifi" />
      {radioOn === false ? (
        <div className="sys-empty">Wi-Fi is off</div>
      ) : nets === null ? (
        <Skeleton />
      ) : nets.length === 0 ? (
        <div className="sys-empty">{scanning ? "Searching…" : "No networks found"}</div>
      ) : (
        <ul className="sys-list">
          {nets.map((n) => (
            <li key={n.ssid}>
              <button
                className={["sys-row", n.connected ? "is-connected" : "", failed === n.ssid ? "is-failed" : ""].join(" ")}
                onClick={() => !n.connected && connect(n.ssid)}
                disabled={!!connecting}
              >
                <SignalIcon bars={n.bars} />
                <span className="sys-row-name">{n.ssid}</span>
                {n.secured && !n.connected && (
                  <span className="sys-row-lock">
                    <LockIcon />
                  </span>
                )}
                <span className="sys-row-state">
                  {connecting === n.ssid ? <span className="sys-dot" /> : n.connected ? <CheckIcon /> : null}
                </span>
              </button>
              {askFor === n.ssid && (
                <form
                  className="sys-pass"
                  onSubmit={(e) => {
                    e.preventDefault();
                    connect(n.ssid, password);
                  }}
                >
                  <input
                    autoFocus
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-label={`Password for ${n.ssid}`}
                  />
                  <button type="submit" className="icon-chip" aria-label="Connect" disabled={!password || !!connecting}>
                    <ArrowIcon />
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BtList({ radioOn, onSearching }: { radioOn: boolean | null; onSearching: (s: boolean) => void }) {
  const [devices, setDevices] = useState<BtDevice[] | null>(null);

  const load = async () => {
    onSearching(true);
    try {
      setDevices(await invoke<BtDevice[]>("bt_devices"));
    } catch (e) {
      console.warn(e);
      setDevices((d) => d ?? []);
    } finally {
      onSearching(false);
    }
  };

  useEffect(() => {
    if (radioOn) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radioOn]);

  return (
    <>
      <PanelHead icon={<BluetoothIcon />} onRefresh={radioOn ? load : undefined} settings="bluetooth" />
      {radioOn === false ? (
        <div className="sys-empty">Bluetooth is off</div>
      ) : devices === null ? (
        <Skeleton />
      ) : devices.length === 0 ? (
        <div className="sys-empty">No paired devices</div>
      ) : (
        <ul className="sys-list">
          {devices.map((d) => (
            <li key={d.name}>
              {/* Windows doesn't let apps connect Bluetooth devices, so this opens Settings. */}
              <button className={`sys-row ${d.connected ? "is-connected" : ""}`} onClick={() => openSettings("bluetooth")}>
                <DeviceIcon name={d.name} />
                <span className="sys-row-name">{d.name}</span>
                <span className="sys-row-state">{d.connected && <CheckIcon />}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const Skeleton = () => (
  <div className="sys-skeleton" aria-hidden>
    <i />
    <i />
    <i />
  </div>
);
