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
import { AUTO_REPLY, checkOutgoing, keywordOf } from "./messaging";
import type { MessagingEvent, MessagingProvider, PhoneProvider, ProviderEvent } from "./provider";
import type { PhoneSettings } from "./settings";
import type { PhoneStore } from "./store";
import type { CallInput, Contact, Message, Presence, TransferTarget } from "./types";

export type ErrorReporter = (source: string, error: unknown, context: Record<string, string>) => void;

export interface EngineDeps {
  store: PhoneStore;
  provider: PhoneProvider;
  messaging: MessagingProvider;
  clock: Clock;
  settings: PhoneSettings;
  newId: () => string;
  reportError: ErrorReporter;
}

export type ActionResult<T = string> = { ok: true; id: T } | { ok: false; reason: string };

export class PhoneEngine {
  private mailbox: (() => void)[] = [];
  /** Round-robin starting point per queue (the demo keeps it in memory). */
  private rotation: Record<string, number> = {};
  private draining = false;
  private unsubscribers: (() => void)[] = [];

  constructor(private readonly deps: EngineDeps) {}

  start(): void {
    this.unsubscribers = [
      this.deps.provider.subscribe((e) => this.onProviderEvent(e)),
      this.deps.messaging.subscribeMessages((e) => this.onMessagingEvent(e)),
    ];
  }

  stop(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }

  /* ---------- Texts ---------- */

  sendText(agentId: string, to: string, body: string): ActionResult {
    const check = checkOutgoing(body, to, this.deps.store.getOptOuts());
    if (!check.ok) return check;
    const message: Message = {
      id: this.deps.newId(),
      number: to,
      direction: "outbound",
      body: check.body,
      at: this.deps.clock.now(),
      status: "sending",
      agentId,
    };
    this.deliver(message);
    return { ok: true, id: message.id };
  }

  /** Try a failed text again. */
  retryText(messageId: string): ActionResult {
    const message = this.deps.store.getMessage(messageId);
    if (!message || message.status !== "failed") return { ok: false, reason: "That message can't be retried." };
    const check = checkOutgoing(message.body, message.number, this.deps.store.getOptOuts());
    if (!check.ok) return check;
    this.deliver({ ...message, status: "sending", error: undefined, at: this.deps.clock.now() });
    return { ok: true, id: message.id };
  }

  markConversationRead(number: string) {
    // Never earlier than the newest text, even if the demo clock was moved back.
    const latest = this.deps.store
      .getMessages()
      .reduce((max, m) => (m.number === number && m.at > max ? m.at : max), 0);
    this.deps.store.markRead(number, Math.max(this.deps.clock.now(), latest));
  }

  /* ---------- Contacts ---------- */

  saveContact(fields: Omit<Contact, "id" | "createdAt">, id?: string): string {
    const existing = id ? this.deps.store.getContacts().find((c) => c.id === id) : undefined;
    const contact: Contact = {
      ...fields,
      id: existing?.id ?? this.deps.newId(),
      createdAt: existing?.createdAt ?? this.deps.clock.now(),
    };
    this.deps.store.saveContact(contact);
    return contact.id;
  }

  deleteContact(id: string) {
    this.deps.store.deleteContact(id);
  }

  /* ---------- Voicemail ---------- */

  markVoicemailHeard(callId: string) {
    const call = this.deps.store.getCall(callId);
    if (!call?.voicemail || call.heardAt) return;
    this.deps.store.saveCall({ ...call, heardAt: this.deps.clock.now() });
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

  /* ---------- During a call ---------- */

  hold(callId: string, agentId: string) {
    this.input(callId, { type: "hold", agentId });
  }

  resume(callId: string, agentId: string) {
    this.input(callId, { type: "resume", agentId });
  }

  park(callId: string, agentId: string) {
    this.input(callId, { type: "park", agentId });
  }

  /** Pick up a parked call. */
  unpark(callId: string, agentId: string) {
    this.input(callId, { type: "unpark", agentId });
  }

  transfer(callId: string, agentId: string, mode: "blind" | "warm", target: TransferTarget) {
    this.input(callId, { type: "transfer", agentId, mode, target });
  }

  completeTransfer(callId: string, agentId: string) {
    this.input(callId, { type: "transfer_complete", agentId });
  }

  cancelTransfer(callId: string, agentId: string) {
    this.input(callId, { type: "transfer_cancel", agentId });
  }

  /** Ring these people to join the call (e.g. VAs to translate); the first to answer joins. */
  invite(callId: string, agentId: string, targets: string[]) {
    this.input(callId, { type: "invite", agentId, targets });
  }

  cancelInvite(callId: string, agentId: string) {
    this.input(callId, { type: "invite_cancel", agentId });
  }

  /** Someone who was added to the call leaves it. */
  leaveCall(callId: string, agentId: string) {
    this.input(callId, { type: "participant_left", agentId });
  }

  /** `agentCell`: call from the agent's own phone (it rings first; see startOutbound). */
  placeOutbound(agentId: string, to: string, opts: { agentCell?: string } = {}): ActionResult {
    const agent = this.deps.store.getAgents().find((a) => a.id === agentId);
    if (!agent) return { ok: false, reason: "Choose who is calling first." };
    if (agent.presence !== "available") {
      return { ok: false, reason: `${agent.name} is ${agent.presence === "busy" ? "already on a call" : "not available"}.` };
    }
    const id = this.deps.newId();
    this.run("placeOutbound", { callId: id, agentId }, () => {
      const result = startOutbound(id, agentId, to, this.ctx(), opts);
      this.apply(result.call.id, result);
    });
    return { ok: true, id };
  }

  setPresence(agentId: string, presence: Presence) {
    this.run("setPresence", { agentId }, () => {
      this.writePresence(agentId, presence);
      if (presence === "available") return;
      // Stop ringing someone who just stepped away.
      for (const call of this.deps.store.listCalls()) {
        const ringsThem =
          (call.state === "ringing" && call.ringingAgentIds.includes(agentId)) ||
          call.transfer?.ringingAgentIds.includes(agentId) ||
          call.inviting?.ringingAgentIds.includes(agentId);
        if (ringsThem) {
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

  private deliver(message: Message) {
    this.deps.store.saveMessage(message);
    try {
      this.deps.messaging.sendMessage({
        id: message.id,
        to: message.number,
        from: this.deps.settings.mainNumber,
        body: message.body,
      });
    } catch (e) {
      this.deps.reportError("engine.sendText", e, { messageId: message.id });
      this.deps.store.saveMessage({ ...message, status: "failed", error: "Could not send" });
    }
  }

  private onMessagingEvent(event: MessagingEvent) {
    this.run("messagingEvent", { type: event.type }, () => {
      const { store, clock } = this.deps;
      if (event.type === "message_status") {
        const message = store.getMessage(event.id);
        if (!message) throw new Error("status for an unknown message");
        store.saveMessage({ ...message, status: event.status, error: event.error });
        return;
      }
      store.saveMessage({
        id: event.id,
        number: event.from,
        direction: "inbound",
        body: event.body,
        at: clock.now(),
        status: "received",
      });
      // Carrier rule: STOP must always work, and gets exactly one confirmation.
      const keyword = keywordOf(event.body);
      if (!keyword) return;
      const optedOut = store.getOptOuts().includes(event.from);
      if (keyword === "stop" && !optedOut) {
        this.autoReply(event.from, AUTO_REPLY.stop);
        store.setOptOut(event.from, true);
      } else if (keyword === "start" && optedOut) {
        store.setOptOut(event.from, false);
        this.autoReply(event.from, AUTO_REPLY.start);
      }
    });
  }

  private autoReply(to: string, body: string) {
    this.deliver({
      id: this.deps.newId(),
      number: to,
      direction: "outbound",
      body,
      at: this.deps.clock.now(),
      status: "sending",
      automatic: true,
    });
  }

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
      if (effect.type === "advance_rotation") {
        const next = (this.rotation[effect.queueId] ?? 0) + 1;
        this.rotation = { ...this.rotation, [effect.queueId]: next % Math.max(1, effect.memberCount) };
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
      rotation: this.rotation,
    };
  }
}
