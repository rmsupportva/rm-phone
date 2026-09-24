/**
 * Building blocks shared by the call brain (callMachine.ts) and the in-call
 * features (inCall.ts). Everything here mutates a DRAFT call that step() has
 * already cloned, and pushes effects; nothing talks to the outside world.
 */
import type { PhoneSettings } from "./settings";
import type { Agent, Call, Effect, EndReason, Lang, PromptId, TimerKind } from "./types";

export interface MachineContext {
  now: number;
  settings: PhoneSettings;
  agents: Agent[];
}

export interface StepResult {
  call: Call;
  effects: Effect[];
}

export const END_REASON_LABEL: Record<EndReason, string> = {
  completed: "Completed",
  voicemail: "Voicemail",
  missed: "Missed",
  abandoned_menu: "Hung up in menu",
  no_answer: "No answer",
  cancelled: "Cancelled",
  failed: "Failed",
  timed_out: "Timed out",
  transferred: "Transferred out",
};

/**
 * A copy of the call that step() can change freely. Only the parts step()
 * mutates are copied; timeline entries, recordings and transcripts are never
 * changed after they are written, so they are shared. (Much cheaper than
 * structuredClone on every input.)
 */
export function cloneCall(c: Call): Call {
  return {
    ...c,
    ringingAgentIds: [...c.ringingAgentIds],
    declinedAgentIds: [...c.declinedAgentIds],
    timeline: [...c.timeline],
    ...(c.deadline && { deadline: { ...c.deadline } }),
    ...(c.participants && { participants: [...c.participants] }),
    ...(c.transfer && {
      transfer: { ...c.transfer, target: { ...c.transfer.target }, ringingAgentIds: [...c.transfer.ringingAgentIds] },
    }),
    ...(c.inviting && { inviting: { ...c.inviting, ringingAgentIds: [...c.inviting.ringingAgentIds] } }),
  };
}

export function log(call: Call, at: number, kind: string, detail?: string) {
  call.timeline.push(detail === undefined ? { at, kind } : { at, kind, detail });
}

export function setDeadline(call: Call, kind: TimerKind, now: number, seconds: number) {
  call.deadline = { kind, at: now + seconds * 1000 };
}

/** Back to the call's own safety cap, counted from when it was first answered. */
export function restoreMaxCall(call: Call, ctx: MachineContext) {
  const from = call.answeredAt ?? ctx.now;
  call.deadline = { kind: "max_call", at: Math.max(ctx.now, from + ctx.settings.maxCallSeconds * 1000) };
}

/** Has a once-answered call run past the safety cap? */
export function pastMaxCall(call: Call, ctx: MachineContext): boolean {
  return call.answeredAt !== undefined && ctx.now >= call.answeredAt + ctx.settings.maxCallSeconds * 1000;
}

export function play(fx: Effect[], prompt: PromptId, lang: Lang) {
  fx.push({ type: "play", prompt, lang });
}

export function agentName(ctx: MachineContext, id: string): string {
  return ctx.agents.find((a) => a.id === id)?.name ?? id;
}

export function isAvailable(ctx: MachineContext, id: string): boolean {
  return ctx.agents.find((a) => a.id === id)?.presence === "available";
}

export function holdCaller(call: Call, fx: Effect[]) {
  if (!call.onHold) {
    call.onHold = true;
    fx.push({ type: "hold_caller" });
  }
}

export function unholdCaller(call: Call, fx: Effect[]) {
  if (call.onHold) {
    call.onHold = false;
    fx.push({ type: "unhold_caller" });
  }
}

/**
 * A caller who has already talked to someone but has nobody with them now
 * (park time ran out, or a transfer target never answered after the agent
 * left). Ring the whole team; if nobody is free, keep them parked. Such a
 * caller is never sent to voicemail.
 */
export function ringHeldCall(call: Call, ctx: MachineContext, fx: Effect[]) {
  const { queue } = ctx.settings;
  const targets = ctx.agents
    .filter((a) => a.presence === "available" && a.queueIds.includes(queue.id))
    .map((a) => a.id);
  if (targets.length === 0) {
    log(call, ctx.now, "nobody_available", "Nobody free: the caller stays parked");
    parkCall(call, ctx, fx);
    return;
  }
  holdCaller(call, fx);
  call.state = "ringing";
  call.ringingAgentIds = targets;
  call.declinedAgentIds = [];
  fx.push({ type: "ring", agentIds: targets });
  setDeadline(call, "ring", ctx.now, queue.ringSeconds);
  log(call, ctx.now, "ringing", `${targets.length} agent${targets.length === 1 ? "" : "s"} (caller on hold)`);
}

/** Park: caller on hold with no agent; anyone can pick them up. */
export function parkCall(call: Call, ctx: MachineContext, fx: Effect[], byAgentId?: string) {
  if (call.ringingAgentIds.length) {
    fx.push({ type: "stop_ringing", agentIds: call.ringingAgentIds });
    call.ringingAgentIds = [];
  }
  holdCaller(call, fx);
  call.state = "parked";
  call.agentId = undefined;
  if (byAgentId) call.parkedBy = byAgentId;
  call.parkedAt = ctx.now;
  setDeadline(call, "park", ctx.now, ctx.settings.parkSeconds);
}

/** Stop everything still ringing or dialling for a transfer or an invite. */
export function clearSideLegs(call: Call, fx: Effect[]) {
  const t = call.transfer;
  if (t) {
    if (t.ringingAgentIds.length) fx.push({ type: "stop_ringing", agentIds: t.ringingAgentIds });
    if (t.target.kind === "external") fx.push({ type: "hang_up_external" });
    else if (t.answeredBy && t.phase === "consulting") {
      fx.push({ type: "remove_from_call", agentId: t.answeredBy });
      fx.push({ type: "set_presence", agentId: t.answeredBy, presence: "available" });
    }
    call.transfer = undefined;
  }
  if (call.inviting) {
    if (call.inviting.ringingAgentIds.length) {
      fx.push({ type: "stop_ringing", agentIds: call.inviting.ringingAgentIds });
    }
    call.inviting = undefined;
  }
}

export function end(call: Call, now: number, reason: EndReason, fx: Effect[]) {
  if (call.ringingAgentIds.length) {
    fx.push({ type: "stop_ringing", agentIds: call.ringingAgentIds });
    call.ringingAgentIds = [];
  }
  clearSideLegs(call, fx);
  for (const p of call.participants ?? []) {
    fx.push({ type: "hang_up_agent", agentId: p });
    fx.push({ type: "set_presence", agentId: p, presence: "wrap_up" });
  }
  call.participants = undefined;
  if (call.answeredAt !== undefined) {
    call.talkSeconds = Math.max(0, Math.round((now - call.answeredAt) / 1000));
  }
  if (call.agentId && (call.state === "answered" || call.state === "dialing")) {
    // After a conversation the agent gets wrap-up time; after a call that
    // never connected they go straight back to available.
    const presence = call.state === "answered" ? "wrap_up" : "available";
    fx.push({ type: "set_presence", agentId: call.agentId, presence });
  }
  call.state = "ended";
  call.endedAt = now;
  call.endReason = reason;
  call.deadline = undefined;
  call.menuStep = undefined;
  call.onHold = undefined;
  log(call, now, "ended", END_REASON_LABEL[reason]);
}
