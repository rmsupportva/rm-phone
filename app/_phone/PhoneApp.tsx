"use client";

import { useCallback, useEffect, useState } from "react";
import { ClockBar } from "./ClockBar";
import { HistoryView } from "./HistoryView";
import { LiveView } from "./LiveView";
import { RuntimeProvider } from "./PhoneContext";
import { clearSavedDemo, createRuntime, type DemoError, type Runtime } from "./runtime";
import { SettingsView } from "./SettingsView";

type Tab = "live" | "history" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export function PhoneApp() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [errors, setErrors] = useState<DemoError[]>([]);
  const [tab, setTab] = useState<Tab>("live");
  const [generation, setGeneration] = useState(0);

  const onError = useCallback((e: DemoError) => setErrors((list) => [e, ...list].slice(0, 5)), []);

  // The runtime lives only in the browser (it uses the clock, storage and timers).
  useEffect(() => {
    const rt = createRuntime(onError);
    setRuntime(rt);
    return () => rt.dispose();
  }, [onError, generation]);

  const resetDemo = () => {
    runtime?.dispose(); // stop saving before the saved copy is wiped
    clearSavedDemo();
    setErrors([]);
    setGeneration((g) => g + 1);
  };

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            RM
          </span>
          <span className="brand-name">
            Phone <span className="brand-sub">new system</span>
          </span>
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tab"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="demo-flag" title="Nothing here is connected to a real phone line or real people.">
          Demo · fake data
        </span>
      </header>

      {runtime ? (
        <RuntimeProvider value={runtime}>
          <ClockBar onReset={resetDemo} />
          {errors.length > 0 && (
            <div className="alert" role="alert">
              <strong>Something went wrong in the demo.</strong> {errors[0].source}: {errors[0].message}
              <button type="button" className="btn btn-quiet" onClick={() => setErrors([])}>
                Dismiss
              </button>
            </div>
          )}
          <main className="page" id="main">
            <h1 className="visually-hidden">RM Phone: new phone system demo</h1>
            {tab === "live" && <LiveView />}
            {tab === "history" && <HistoryView />}
            {tab === "settings" && <SettingsView />}
          </main>
        </RuntimeProvider>
      ) : (
        <main className="page">
          <p className="loading" role="status">
            Starting the phone system…
          </p>
        </main>
      )}
    </>
  );
}
