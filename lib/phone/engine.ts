/**
 * The engine connects the call brain to the outside world.
 *
 *  - Carrier events and agent actions become inputs for `step()`.
 *  - Inputs are processed one at a time, in order (a mailbox), so two
 *    things can never change the same call at once.
 *  - Effects go back out: presence changes are ours, everything else is the
 *    carrier's job.
 *  - `tick()` fires every deadline that has passed. It keeps no timers of
 *    its own, so nothing is lost if the process restarts: a server version
 *    runs the same sweep from the database.
 */
import {
  startInbound,
  startOutbound,
  step,
  type MachineContext,
  type StepResult,
} from "./callMachine";
import type { Clock } from "./clock";
import type { PhoneProvider, ProviderEvent } from "./provider";
import type { PhoneSettings } from "./settings";
import type { PhoneStore } from "./store";
import type { CallInput, Presence } from "./types";

export type ErrorReporter = (source: string, error: unknown, context: Record<string, string>) => void;

export interface EngineDeps {
  store: PhoneStore;
  provider: PhoneProvider;
  clock: Clock;
  settings: PhoneSettings;
  newId: () => string;
  reportError: ErrorReporter;
}

export class PhoneEngine {
  private mailbox: (() => void)[] = [];
  private draining = false;
  private unsubscribe?: () => void;

  constructor(private readonly deps: EngineDeps) {}

  start(): void {
    this.unsubscribe = this.deps.provider.subscribe((e) => this.onProviderEvent(e));
  }

  stop(): void {
    this.unsubscribe?.();
  }

  /* ---------- Agent actions (from the softphone) ---------- */

  answer(callId: string, agentId: string) {
    this.input(callId, { type: "agent_answered", agentId });
  }

  decline(callId: string, agentId: string) {
    this.input(callId, { type: "agent_declined", agentId });
  }

  hangUp(callId: string, agentId: string) {
    this.input(callId, { type: "agent_hung_up", agentId });
  }

  placeOutbound(agentId: string, to: string): string {
    const id = this.deps.newId();
    this.run("placeOutbound", { callId: id, agentId }, () => {
      const agent = this.deps.store.getAgents().find((a) => a.id === agentId);
      if (!agent || agent.presence !== "available") {
        throw new Error("agent is not available to dial");
      }
      const result = startOutbound(id, agentId, to, this.ctx());
      this.apply(result.call.id, result);
    });
    return id;
  }

  setPresence(agentId: string, presence: Presence) {
    this.run("setPresence", { agentId }, () => {
      this.writePresence(agentId, presence);
      if (presence === "available") return;
      // Stop ringing someone who just stepped away.
      for (const call of this.deps.store.listCalls()) {
        if (call.state === "ringing" && call.ringingAgentIds.includes(agentId)) {
          this.enqueueInput(call.id, { type: "agent_unavailable", agentId });
        }
      }
    });
  }

  /** Fire every deadline that has passed. Call this often (every ~250 ms). */
  tick() {
    const now = this.deps.clock.now();
    for (const call of this.deps.store.listCalls()) {
      if (call.deadline && call.deadline.at <= now) {
        this.enqueueInput(call.id, { type: "timer", kind: call.deadline.kind });
      }
    }
    this.drain();
  }

  /* ---------- Internals ---------- */

  private onProviderEvent(event: ProviderEvent) {
    if (event.type === "incoming_call") {
      this.run("incomingCall", { callId: event.callId }, () => {
        const result = startInbound(event.callId, event.from, this.ctx());
        this.apply(event.callId, result);
      });
    } else {
      this.input(event.callId, event.input);
    }
  }

  private input(callId: string, input: CallInput) {
    this.enqueueInput(callId, input);
    this.drain();
  }

  private enqueueInput(callId: string, input: CallInput) {
    this.mailbox.push(() => {
      try {
        const call = this.deps.store.getCall(callId);
        if (!call) throw new Error("unknown call");
        this.apply(callId, step(call, input, this.ctx()));
      } catch (e) {
        this.deps.reportError("engine.step", e, { callId, input: input.type });
      }
    });
  }

  private run(source: string, context: Record<string, string>, task: () => void) {
    this.mailbox.push(() => {
      try {
        task();
      } catch (e) {
        this.deps.reportError(`engine.${source}`, e, context);
      }
    });
    this.drain();
  }

  private drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      // Every task catches and reports its own errors, so one bad input
      // never stops the ones queued behind it.
      while (this.mailbox.length) this.mailbox.shift()!();
    } finally {
      this.draining = false;
    }
  }

  private apply(callId: string, result: StepResult) {
    const before = this.deps.store.getCall(callId);
    if (before !== result.call) this.deps.store.saveCall(result.call);
    for (const effect of result.effects) {
      if (effect.type === "set_presence") {
        this.writePresence(effect.agentId, effect.presence);
        continue;
      }
      try {
        this.deps.provider.perform(callId, effect);
      } catch (e) {
        this.deps.reportError("engine.provider", e, { callId, effect: effect.type });
      }
    }
  }

  private writePresence(agentId: string, presence: Presence) {
    const agent = this.deps.store.getAgents().find((a) => a.id === agentId);
    if (!agent || agent.presence === presence) return;
    this.deps.store.saveAgent({ ...agent, presence });
  }

  private ctx(): MachineContext {
    return {
      now: this.deps.clock.now(),
      settings: this.deps.settings,
      agents: this.deps.store.getAgents(),
    };
  }
}
