"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CallDock } from "./CallDock";
import { CallsView } from "./CallsView";
import { ClockBar } from "./ClockBar";
import { ContactsView } from "./ContactsView";
import { LiveView } from "./LiveView";
import { MessagesView } from "./MessagesView";
import { RuntimeProvider, ShellProvider, usePhoneData, type Section, type Shell } from "./PhoneContext";
import { clearSavedDemo, createRuntime, loadMe, saveMe, type DemoError, type Runtime } from "./runtime";
import { SettingsView } from "./SettingsView";
import { MeSelect, Sidebar } from "./Sidebar";
import { Toasts, type Toast } from "./Toasts";
import { VoicemailView } from "./VoicemailView";

export function PhoneApp() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [errors, setErrors] = useState<DemoError[]>([]);
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
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            RM
          </span>
          <span className="brand-name">
            Phone <span className="brand-sub">new system</span>
          </span>
        </div>
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
          <PhoneShell />
        </RuntimeProvider>
      ) : (
        <main className="page">
          <p className="loading" role="status">
            Starting the phone system…
          </p>
        </main>
      )}
    </div>
  );
}

function PhoneShell() {
  const { agents } = usePhoneData();
  const [meId, setMeId] = useState(() => loadMe(agents[0]?.id ?? ""));
  const [section, setSection] = useState<Section>("messages");
  const [selection, setSelection] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const toast = useCallback((message: string, tone: "info" | "error" = "info") => {
    const id = ++toastSeq.current;
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5000);
  }, []);

  const shell: Shell = useMemo(
    () => ({
      me: agents.find((a) => a.id === meId),
      setMe: (id) => {
        setMeId(id);
        saveMe(id);
      },
      section,
      selection,
      navigate: (next, sel = null) => {
        setSection(next);
        setSelection(sel);
      },
      select: setSelection,
      toast,
    }),
    [agents, meId, section, selection, toast],
  );

  return (
    <ShellProvider value={shell}>
      <div className="shell">
        <Sidebar />
        <main className="content" id="main">
          <h1 className="visually-hidden">RM Phone: new phone system demo</h1>
          <div className="me-mobile">
            <MeSelect id="me-select-mobile" />
          </div>
          {section === "calls" && <CallsView />}
          {section === "messages" && <MessagesView />}
          {section === "voicemail" && <VoicemailView />}
          {section === "contacts" && <ContactsView />}
          {section === "team" && <LiveView />}
          {section === "settings" && <SettingsView />}
        </main>
      </div>
      <CallDock />
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
    </ShellProvider>
  );
}
