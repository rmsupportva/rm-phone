/**
 * Test support: a CallsTable kept in memory, with the same version rules as
 * the database (save only if the version is unchanged). Not used in production.
 */
import type { Call, Presence, TimelineEntry, TimerKind } from "../types";
import type { CallsTable } from "./callRunner";

export class MemoryTable implements CallsTable {
  rows = new Map<string, { call: Call; version: number; providerSid?: string }>();
  events: { callId: string; entry: TimelineEntry }[] = [];
  presence = new Map<string, Presence>();
  /** Test hook: runs once just before the next update, to simulate a concurrent writer. */
  beforeNextUpdate?: () => void;

  async load(id: string) {
    const r = this.rows.get(id);
    return r ? { call: r.call, version: r.version } : null;
  }
  async findByProviderSid(sid: string) {
    const r = [...this.rows.values()].find((x) => x.providerSid === sid);
    return r ? { call: r.call, version: r.version } : null;
  }
  async insert(call: Call, providerSid?: string) {
    if (providerSid && (await this.findByProviderSid(providerSid))) return false;
    this.rows.set(call.id, { call, version: 0, providerSid });
    return true;
  }
  async update(call: Call, expected: number) {
    const hook = this.beforeNextUpdate;
    this.beforeNextUpdate = undefined;
    hook?.();
    const r = this.rows.get(call.id);
    if (!r || r.version !== expected) return false;
    this.rows.set(call.id, { ...r, call, version: expected + 1 });
    return true;
  }
  async appendEvents(callId: string, entries: TimelineEntry[]) {
    for (const entry of entries) this.events.push({ callId, entry });
  }
  async dueDeadlines(now: number) {
    return [...this.rows.values()]
      .filter((r) => r.call.deadline && r.call.deadline.at <= now)
      .map((r) => ({ id: r.call.id, kind: r.call.deadline!.kind as TimerKind }));
  }
  async setPresence(agentId: string, p: Presence) {
    this.presence.set(agentId, p);
  }
}
