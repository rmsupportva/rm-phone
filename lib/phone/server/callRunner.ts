/**
 * Running calls on a server, where every carrier webhook may be handled by a
 * different request (or a different machine) and the only shared memory is
 * the database.
 *
 * The browser engine (engine.ts) gets "one input at a time" from a mailbox.
 * Here the same guarantee comes from optimistic concurrency: load the call and
 * its version, step() it, and save only if the version is still the same. If
 * another request changed the call in between, load again and redo the step.
 * Effects are returned only after the save succeeded, so a lost race never
 * rings, dials or hangs up anything twice.
 *
 * `CallsTable` is the storage port; `supabaseStore.ts` implements it for the
 * phone_calls tables, and the tests use an in-memory version.
 */
import { startInbound, startOutbound, step, type MachineContext, type StepResult } from "../callMachine";
import type { Call, CallInput, Effect, Presence, TimelineEntry, TimerKind } from "../types";

export interface StoredCall {
  call: Call;
  version: number;
}

export interface CallsTable {
  load(callId: string): Promise<StoredCall | null>;
  /** Find a call by the carrier's id for it (webhooks only know that id). */
  findByProviderSid(providerSid: string): Promise<StoredCall | null>;
  /** Insert a new call. Returns false if one with this provider id already exists. */
  insert(call: Call, providerSid?: string): Promise<boolean>;
  /** Save only if the stored version is still `expectedVersion`. Returns false on a lost race. */
  update(call: Call, expectedVersion: number): Promise<boolean>;
  appendEvents(callId: string, entries: TimelineEntry[]): Promise<void>;
  /** Calls whose deadline has passed, oldest first. */
  dueDeadlines(now: number, limit: number): Promise<{ id: string; kind: TimerKind }[]>;
  setPresence(agentId: string, presence: Presence): Promise<void>;
}

export interface RunnerDeps {
  table: CallsTable;
  /** Settings, the team's current presence and the time, read fresh for every step. */
  context: () => Promise<MachineContext>;
  reportError: (source: string, error: unknown, context: Record<string, string>) => void;
  /** How many times to redo a step after losing a race. */
  maxAttempts?: number;
}

export interface RunResult {
  call: Call;
  /** Effects for the carrier to carry out. Presence changes are already saved. */
  effects: Effect[];
}

/** Start an inbound call. A webhook retried by the carrier finds the existing call and does nothing. */
export async function startInboundCall(
  deps: RunnerDeps,
  id: string,
  from: string,
  providerSid: string,
): Promise<RunResult | null> {
  const ctx = await deps.context();
  return insertNew(deps, startInbound(id, from, ctx), providerSid);
}

export async function startOutboundCall(
  deps: RunnerDeps,
  id: string,
  agentId: string,
  to: string,
): Promise<RunResult | null> {
  const ctx = await deps.context();
  return insertNew(deps, startOutbound(id, agentId, to, ctx));
}

/** Apply one input to a stored call, safely against concurrent webhooks. */
export async function applyInput(deps: RunnerDeps, callId: string, input: CallInput): Promise<RunResult | null> {
  const attempts = deps.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const stored = await deps.table.load(callId);
    if (!stored) {
      deps.reportError("phone.runner.unknown_call", new Error("input for an unknown call"), { callId, input: input.type });
      return null;
    }
    const result = step(stored.call, input, await deps.context());
    if (result.call === stored.call) return { call: stored.call, effects: result.effects }; // nothing changed
    if (await deps.table.update(result.call, stored.version)) {
      return finish(deps, stored.call, result);
    }
    // Lost the race: someone else changed this call. Load it again and redo the step.
  }
  deps.reportError("phone.runner.contention", new Error("gave up after repeated conflicts"), { callId, input: input.type });
  return null;
}

/**
 * Fire every deadline that has passed. Run this every few seconds (a cron
 * route): it is what guarantees no call stays open, even after a restart.
 * Returns the effects of each call it moved, for the carrier.
 */
export async function sweepDeadlines(deps: RunnerDeps, now: number, limit = 100): Promise<RunResult[]> {
  const due = await deps.table.dueDeadlines(now, limit);
  const out: RunResult[] = [];
  for (const d of due) {
    try {
      const r = await applyInput(deps, d.id, { type: "timer", kind: d.kind });
      if (r && r.effects.length) out.push(r);
    } catch (e) {
      // One broken call must not stop the sweep for the others.
      deps.reportError("phone.runner.sweep", e, { callId: d.id, kind: d.kind });
    }
  }
  return out;
}

async function insertNew(deps: RunnerDeps, result: StepResult, providerSid?: string): Promise<RunResult | null> {
  if (!(await deps.table.insert(result.call, providerSid))) return null; // already started by an earlier delivery
  return finish(deps, undefined, result);
}

async function finish(deps: RunnerDeps, before: Call | undefined, result: StepResult): Promise<RunResult> {
  const newEntries = result.call.timeline.slice(before?.timeline.length ?? 0);
  const carrier: Effect[] = [];
  const writes: Promise<void>[] = [];
  if (newEntries.length) writes.push(deps.table.appendEvents(result.call.id, newEntries));
  for (const e of result.effects) {
    if (e.type === "set_presence") writes.push(deps.table.setPresence(e.agentId, e.presence));
    else carrier.push(e);
  }
  // The call itself is already saved; these are records and presence. Report,
  // don't fail: the carrier still needs its effects.
  const settled = await Promise.allSettled(writes);
  for (const s of settled) {
    if (s.status === "rejected") deps.reportError("phone.runner.side_write", s.reason, { callId: result.call.id });
  }
  return { call: result.call, effects: carrier };
}
