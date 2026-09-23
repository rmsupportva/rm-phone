import type { Agent, Call } from "./types";

/**
 * Where calls and agents are kept. The demo keeps them in memory (and the
 * browser); the real build swaps in a database behind the same shape.
 */
export interface PhoneStore {
  getCall(id: string): Call | undefined;
  listCalls(): Call[];
  saveCall(call: Call): void;
  getAgents(): Agent[];
  saveAgent(agent: Agent): void;
}

export interface Snapshot {
  calls: Call[];
  agents: Agent[];
}

export class MemoryStore implements PhoneStore {
  private calls = new Map<string, Call>();
  private agents = new Map<string, Agent>();
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { calls: [], agents: [] };

  constructor(initial: Snapshot) {
    for (const c of initial.calls) this.calls.set(c.id, c);
    for (const a of initial.agents) this.agents.set(a.id, a);
    this.refresh();
  }

  getCall(id: string) {
    return this.calls.get(id);
  }

  listCalls() {
    return this.snapshot.calls;
  }

  saveCall(call: Call) {
    this.calls.set(call.id, call);
    this.changed();
  }

  getAgents() {
    return this.snapshot.agents;
  }

  saveAgent(agent: Agent) {
    this.agents.set(agent.id, agent);
    this.changed();
  }

  /** For React's useSyncExternalStore: a stable object until something changes. */
  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed() {
    this.refresh();
    for (const l of this.listeners) l();
  }

  private refresh() {
    this.snapshot = {
      calls: [...this.calls.values()].sort((a, b) => b.startedAt - a.startedAt),
      agents: [...this.agents.values()],
    };
  }
}
