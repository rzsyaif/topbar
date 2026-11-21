import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { locateOnce, type Place } from "../hooks/useLocation";
import type { useSettings } from "../hooks/useSettings";
import type { PrayerTime } from "../hooks/usePrayer";
import { suggestMethod } from "../lib/prayerMethods";
import { clock } from "../lib/format";
import { CitySearch, MethodPicker, Row, Seg, Switch } from "./Settings";

type SettingsApi = ReturnType<typeof useSettings>;
const STEPS = 4;

/**
 * First launch: four short steps so the island is right for wherever you are.
 * 1. Hello  2. Location  3. Prayer times  4. A few preferences
 */
export function Welcome({ api, place, today, onDone }: { api: SettingsApi; place: Place; today: PrayerTime[]; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [found, setFound] = useState<Place | null>(null);
  const [autostart, setAutostart] = useState(true);
  const s = api.settings;

  // When we learn the country, preselect the usual method there.
  const country = s.location.mode === "manual" ? s.location.city?.countryCode : found?.countryCode;
  useEffect(() => {
    if (!country) return;
    const sug = suggestMethod(country);
    api.setPrayer({ method: sug.method, madhab: sug.madhab });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  const useMyLocation = async () => {
    setLocating(true);
    setLocError(null);
    try {
      const p = await locateOnce();
      setFound(p);
      api.setLocation({ mode: "auto" });
    } catch {
      setLocError("Location is off. Turn it on in Windows Settings → Privacy & security → Location, or choose a city.");
    } finally {
      setLocating(false);
    }
  };

  const finish = () => {
    invoke("autostart_set", { on: autostart }).catch(() => {});
    onDone();
  };

  const hasPlace = (s.location.mode === "manual" && !!s.location.city) || !!found;

  return (
    <div className="welcome">
      <div className="welcome-dots" aria-hidden>
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={i === step ? "is-current" : i < step ? "is-done" : ""} />
        ))}
      </div>

      <div className="welcome-body" key={step}>
        {step === 0 && (
          <div className="welcome-hello">
            <div className="welcome-mark" aria-hidden />
            <h1>Island</h1>
            <p>Music, prayer times, focus, notes and your shelf, tucked at the top of your screen. Hover it any time to open it.</p>
          </div>
        )}

        {step === 1 && (
          <>
            <h2>Where are you?</h2>
            <p className="welcome-sub">For weather and prayer times.</p>
            <div className="welcome-choices">
              <button
                className={`choice ${s.location.mode === "auto" && found ? "is-active" : ""}`}
                onClick={useMyLocation}
                disabled={locating}
              >
                <span className="choice-title">{locating ? "Finding you…" : "Use my location"}</span>
                <span className="set-hint">{found ? found.name : "Updates when you travel"}</span>
              </button>
              <button
                className={`choice ${s.location.mode === "manual" ? "is-active" : ""}`}
                onClick={() => api.setLocation({ mode: "manual" })}
              >
                <span className="choice-title">Choose a city</span>
                <span className="set-hint">{s.location.mode === "manual" && s.location.city ? s.location.city.name : "Works without location"}</span>
              </button>
            </div>
            {locError && <p className="welcome-error">{locError}</p>}
            {s.location.mode === "manual" && (
              <CitySearch
                autoFocus
                onPick={(c) =>
                  api.setLocation({
                    mode: "manual",
                    city: { name: c.name, country: c.country, countryCode: c.countryCode, latitude: c.latitude, longitude: c.longitude },
                  })
                }
              />
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h2>Prayer times</h2>
            <p className="welcome-sub">We picked the usual method for {place.name}. Change it if your mosque uses another.</p>
            <MethodPicker value={s.prayer.method} suggested={suggestMethod(country).method} onChange={(method) => api.setPrayer({ method })} />
            <Row label="Asr">
              <Seg
                value={s.prayer.madhab}
                options={[
                  ["shafi", "Standard"],
                  ["hanafi", "Hanafi"],
                ]}
                onChange={(madhab) => api.setPrayer({ madhab })}
              />
            </Row>
            <div className="welcome-times">
              {today.map((t) => (
                <span key={t.name}>
                  <span className="set-hint">{t.label}</span>
                  <b className="tabular">{clock(t.time)}</b>
                </span>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Almost done</h2>
            <p className="welcome-sub">You can change these later: click the clock in the island.</p>
            <Row label="Start with Windows">
              <Switch label="Start with Windows" on={autostart} onChange={setAutostart} />
            </Row>
            <Row label="24-hour time">
              <Switch label="24-hour time" on={s.general.use24h} onChange={(v) => api.setGeneral({ use24h: v })} />
            </Row>
            <Row label="Liquid glass" hint="Blur behind the island">
              <Switch label="Liquid glass" on={s.general.glass} onChange={(v) => api.setGeneral({ glass: v })} />
            </Row>
          </>
        )}
      </div>

      <div className="welcome-foot">
        {step > 0 ? (
          <button className="text-btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : (
          <button className="text-btn" onClick={onDone}>
            Skip setup
          </button>
        )}
        {step < STEPS - 1 ? (
          <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={step === 1 && locating}>
            {step === 0 ? "Get started" : step === 1 && !hasPlace ? "Skip for now" : "Next"}
          </button>
        ) : (
          <button className="btn-primary" onClick={finish}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}
