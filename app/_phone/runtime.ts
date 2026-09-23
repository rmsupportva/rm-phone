/**
 * Wires the phone system together for the browser demo: the call brain, the
 * pretend phone company, an in-memory store saved to this browser, and a
 * clock you can move.
 */
import { SimClock } from "@/lib/phone/clock";
import { PhoneEngine } from "@/lib/phone/engine";
import { DEMO_AGENTS } from "@/lib/phone/mock/fakeData";
import { MockProvider } from "@/lib/phone/mock/mockProvider";
import { DEMO_SETTINGS } from "@/lib/phone/settings";
import { MemoryStore, type Snapshot } from "@/lib/phone/store";

const STORAGE_KEY = "rm-phone-demo-v1";

export interface DemoError {
  at: number;
  source: string;
  message: string;
}

export interface Runtime {
  store: MemoryStore;
  clock: SimClock;
  provider: MockProvider;
  engine: PhoneEngine;
  dispose(): void;
}

export function createRuntime(onError: (e: DemoError) => void): Runtime {
  const clock = new SimClock();
  const newId = () => crypto.randomUUID();
  const store = new MemoryStore(loadSnapshot());
  const provider = new MockProvider({
    clock,
    newId,
    greetingSeconds: DEMO_SETTINGS.voicemailGreetingSeconds,
  });
  const engine = new PhoneEngine({
    store,
    provider,
    clock,
    settings: DEMO_SETTINGS,
    newId,
    reportError: (source, error, context) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[rm-phone] ${source}: ${message}`, context);
      onError({ at: Date.now(), source, message });
    },
  });
  engine.start();

  // Fire deadlines. Calls restored from a previous visit that were still
  // open get closed by the same sweep, so nothing is left hanging.
  const timer = window.setInterval(() => engine.tick(), 250);
  const unsubscribe = store.subscribe(() => saveSnapshot(store.getSnapshot()));

  return {
    store,
    clock,
    provider,
    engine,
    dispose() {
      window.clearInterval(timer);
      unsubscribe();
      engine.stop();
    },
  };
}

export function clearSavedDemo() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private window): nothing was saved, nothing to clear.
  }
}

function loadSnapshot(): Snapshot {
  const fresh: Snapshot = { calls: [], agents: structuredClone(DEMO_AGENTS) };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Snapshot;
    if (!Array.isArray(saved.calls) || !Array.isArray(saved.agents)) return fresh;
    return saved;
  } catch {
    return fresh;
  }
}

function saveSnapshot(snapshot: Snapshot) {
  try {
    // Keep the newest 200 calls so the demo never fills the browser.
    const trimmed = { ...snapshot, calls: snapshot.calls.slice(0, 200) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full or blocked: the demo keeps working, it just won't remember.
  }
}
