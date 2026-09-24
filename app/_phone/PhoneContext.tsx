"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { contactForNumber } from "@/lib/phone/contacts";
import type { Snapshot } from "@/lib/phone/store";
import type { Agent, Contact } from "@/lib/phone/types";
import { formatPhone } from "./format";
import type { Runtime } from "./runtime";

/* ---------- Runtime ---------- */

const RuntimeContext = createContext<Runtime | null>(null);
export const RuntimeProvider = RuntimeContext.Provider;

export function useRuntime(): Runtime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error("useRuntime outside RuntimeProvider");
  return rt;
}

/** Everything the phone system holds; re-renders whenever any of it changes. */
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

/* ---------- Names for numbers ---------- */

export interface Directory {
  contactFor(e164: string): Contact | undefined;
  /** The contact's name, or the formatted number. */
  nameFor(e164: string): string;
}

export function useDirectory(): Directory {
  const { contacts } = usePhoneData();
  return useMemo(
    () => ({
      contactFor: (e164: string) => contactForNumber(contacts, e164),
      nameFor: (e164: string) => contactForNumber(contacts, e164)?.name ?? formatPhone(e164),
    }),
    [contacts],
  );
}

/* ---------- Who is using the app, where they are, and toasts ---------- */

export type Section = "calls" | "messages" | "voicemail" | "contacts" | "team" | "settings";

export interface Shell {
  me: Agent | undefined;
  setMe(agentId: string): void;
  section: Section;
  /** The open item in the section: a call id, a phone number or a contact id. */
  selection: string | null;
  navigate(section: Section, selection?: string | null): void;
  select(selection: string | null): void;
  toast(message: string, tone?: "info" | "error"): void;
}

const ShellContext = createContext<Shell | null>(null);
export const ShellProvider = ShellContext.Provider;

export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell outside ShellProvider");
  return shell;
}

/** Place a call as the signed-in person, and say so if it can't happen. */
export function useCallNumber() {
  const { engine } = useRuntime();
  const { me, toast } = useShell();
  return useCallback(
    (e164: string) => {
      if (!me) {
        toast("Choose who you are first (bottom of the menu).", "error");
        return;
      }
      const r = engine.placeOutbound(me.id, e164);
      if (!r.ok) toast(r.reason, "error");
    },
    [engine, me, toast],
  );
}
