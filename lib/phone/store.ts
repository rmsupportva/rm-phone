import type { Agent, Call, Contact, Message } from "./types";

/**
 * Where calls, agents, contacts and texts are kept. The demo keeps them in
 * memory (and the browser); the real build swaps in a database behind the
 * same shape.
 */
export interface PhoneStore {
  getCall(id: string): Call | undefined;
  listCalls(): Call[];
  saveCall(call: Call): void;
  getAgents(): Agent[];
  saveAgent(agent: Agent): void;

  getContacts(): Contact[];
  saveContact(contact: Contact): void;
  deleteContact(id: string): void;

  getMessages(): Message[];
  getMessage(id: string): Message | undefined;
  saveMessage(message: Message): void;
  getOptOuts(): string[];
  setOptOut(number: string, optedOut: boolean): void;
  markRead(number: string, at: number): void;
}

export interface Snapshot {
  calls: Call[];
  agents: Agent[];
  contacts: Contact[];
  messages: Message[];
  optOuts: string[];
  /** Per conversation number: when it was last read. */
  reads: Record<string, number>;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  calls: [],
  agents: [],
  contacts: [],
  messages: [],
  optOuts: [],
  reads: {},
};

export class MemoryStore implements PhoneStore {
  private calls = new Map<string, Call>();
  private agents = new Map<string, Agent>();
  private contacts = new Map<string, Contact>();
  private messages = new Map<string, Message>();
  private optOuts = new Set<string>();
  private reads: Record<string, number> = {};
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = EMPTY_SNAPSHOT;

  constructor(initial: Partial<Snapshot>) {
    for (const c of initial.calls ?? []) this.calls.set(c.id, c);
    for (const a of initial.agents ?? []) this.agents.set(a.id, a);
    for (const c of initial.contacts ?? []) this.contacts.set(c.id, c);
    for (const m of initial.messages ?? []) this.messages.set(m.id, m);
    for (const n of initial.optOuts ?? []) this.optOuts.add(n);
    this.reads = { ...(initial.reads ?? {}) };
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

  getContacts() {
    return this.snapshot.contacts;
  }
  saveContact(contact: Contact) {
    this.contacts.set(contact.id, contact);
    this.changed();
  }
  deleteContact(id: string) {
    if (this.contacts.delete(id)) this.changed();
  }

  getMessages() {
    return this.snapshot.messages;
  }
  getMessage(id: string) {
    return this.messages.get(id);
  }
  saveMessage(message: Message) {
    this.messages.set(message.id, message);
    this.changed();
  }
  getOptOuts() {
    return this.snapshot.optOuts;
  }
  setOptOut(number: string, optedOut: boolean) {
    const had = this.optOuts.has(number);
    if (optedOut === had) return;
    if (optedOut) this.optOuts.add(number);
    else this.optOuts.delete(number);
    this.changed();
  }
  markRead(number: string, at: number) {
    if ((this.reads[number] ?? 0) >= at) return;
    this.reads = { ...this.reads, [number]: at };
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
      contacts: [...this.contacts.values()],
      messages: [...this.messages.values()].sort((a, b) => a.at - b.at),
      optOuts: [...this.optOuts],
      reads: this.reads,
    };
  }
}
