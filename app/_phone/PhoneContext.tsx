"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { Snapshot } from "@/lib/phone/store";
import type { Runtime } from "./runtime";

const RuntimeContext = createContext<Runtime | null>(null);

export const RuntimeProvider = RuntimeContext.Provider;

export function useRuntime(): Runtime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error("useRuntime outside RuntimeProvider");
  return rt;
}

/** Calls and agents; re-renders whenever either changes. */
export function usePhoneData(): Snapshot {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** The demo clock's current time, refreshed a few times a second for countdowns. */
export function useNow(intervalMs = 250): number {
  const { clock } = useRuntime();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(clock.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [clock, intervalMs]);
  return now;
}
