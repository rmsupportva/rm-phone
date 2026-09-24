/**
 * What an agent can do DURING a call: hold, park, transfer and add someone
 * (e.g. a VA to translate). step() in callMachine.ts hands every input here
 * first; `null` means "not an in-call matter" and step() carries on.
 *
 * Rules, most of them lessons from the old phone system:
 *  - The agent stays on the call until a transfer target has actually
 *    answered. A transfer nobody picks up comes back to them: "you still have
 *    the caller". (blind = hand over the moment the target answers; warm =
 *    talk to the target first, then Complete.)
 *  - Hold / park before anyone leaves, so the caller is never left in silence.
 *  - A caller who has already talked to us is never sent to voicemail. If they
 *    end up with nobody (park time ran out, or the agent left mid-transfer and
 *    the target never answered), the whole team is rung, and failing that the
 *    call stays parked.
 *  - Every state still has a deadline: transfer and invite rings time out,
 *    parking times out, and the safety cap still ends everything.
 */
import {
  agentName,
  clearSideLegs,
  end,
  holdCaller,
  isAvailable,
  log,
  parkCall,
  pastMaxCall,
  restoreMaxCall,
  ringHeldCall,
  setDeadline,
  unholdCaller,
  type MachineContext,
  type StepResult,
} from "./machineParts";
import type { Call, CallInput, Effect, TransferTarget } from "./types";

export function stepInCall(
  current: Call,
  call: Call,
  input: CallInput,
  ctx: MachineContext,
  fx: Effect[],
): StepResult | null {
  const { now } = ctx;
  const unchanged: StepResult = { call: current, effects: [] };
  const done: StepResult = { call, effects: fx };
  const mine = (agentId: string) => call.state === "answered" && call.agentId === agentId;
  const t = call.transfer;

  switch (input.type) {
    /* ---------- Hold ---------- */
    case "hold":
      if (!mine(input.agentId) || t || call.onHold) return unchanged;
      holdCaller(call, fx);
      log(call, now, "hold", agentName(ctx, input.agentId));
      return done;

    case "resume":
      if (!mine(input.agentId) || t || !call.onHold) return unchanged;
      unholdCaller(call, fx);
      log(call, now, "resumed", agentName(ctx, input.agentId));
      return done;

    /* ---------- Park ---------- */
    case "park": {
      if (!mine(input.agentId) || t || call.inviting) return unchanged;
      const a = input.agentId;
      fx.push({ type: "remove_from_call", agentId: a });
      fx.push({ type: "set_presence", agentId: a, presence: "available" });
      for (const p of call.participants ?? []) {
        fx.push({ type: "remove_from_call", agentId: p });
        fx.push({ type: "set_presence", agentId: p, presence: "available" });
      }
      call.participants = undefined;
      parkCall(call, ctx, fx, a);
      log(call, now, "parked", agentName(ctx, a));
      return done;
    }

    case "unpark": {
      if (call.state !== "parked" || !isAvailable(ctx, input.agentId)) return unchanged;
      const a = input.agentId;
      call.state = "answered";
      call.agentId = a;
      call.parkedBy = undefined;
      call.parkedAt = undefined;
      unholdCaller(call, fx);
      fx.push({ type: "connect", agentId: a });
      fx.push({ type: "set_presence", agentId: a, presence: "busy" });
      restoreMaxCall(call, ctx);
      log(call, now, "picked_up", agentName(ctx, a));
      return done;
    }

    /* ---------- Transfer ---------- */
    case "transfer": {
      if (!mine(input.agentId) || t || call.inviting) return unchanged;
      const target = input.target;
      const ringing = transferTargets(target, input.agentId, ctx);
      if (ringing === null) {
        log(call, now, "transfer_failed", `${targetLabel(target, ctx)} can't take calls right now`);
        return done;
      }
      holdCaller(call, fx);
      call.transfer = {
        mode: input.mode,
        target,
        phase: "ringing",
        byAgentId: input.agentId,
        ringingAgentIds: ringing,
        startedAt: now,
      };
      if (ringing.length) fx.push({ type: "ring", agentIds: ringing });
      if (target.kind === "external") fx.push({ type: "dial_external", to: target.to });
      setDeadline(call, "transfer", now, ctx.settings.transferSeconds);
      log(call, now, "transfer_started", `${input.mode === "warm" ? "Warm" : "Blind"} to ${targetLabel(target, ctx)}`);
      return done;
    }

    case "transfer_complete":
      if (!t || t.phase !== "consulting" || t.byAgentId !== input.agentId) return unchanged;
      completeTransfer(call, ctx, fx);
      return done;

    case "transfer_cancel":
      if (!t || t.byAgentId !== input.agentId) return unchanged;
      clearSideLegs(call, fx);
      unholdCaller(call, fx);
      restoreMaxCall(call, ctx);
      log(call, now, "transfer_cancelled", agentName(ctx, input.agentId));
      return done;

    case "external_answered":
      if (!t || t.phase !== "ringing" || t.target.kind !== "external") return unchanged;
      t.answeredBy = "external";
      log(call, now, "transfer_answered", t.target.to);
      if (t.mode === "blind" || !t.byAgentId) completeTransfer(call, ctx, fx);
      else {
        t.phase = "consulting";
        restoreMaxCall(call, ctx);
      }
      return done;

    case "external_failed":
    case "external_hung_up":
      if (!t || t.target.kind !== "external") return unchanged;
      transferFailed(call, ctx, fx, input.type === "external_failed" ? "The number could not be reached" : "They hung up");
      return done;

    /* ---------- Add someone (e.g. a VA to translate) ---------- */
    case "invite": {
      if (!mine(input.agentId) || call.inviting || t) return unchanged;
      const cascade = input.thenTargets !== undefined;
      const first = joinable(call, ctx, input.agentId, input.targets);
      const next = cascade ? input.thenTargets! : undefined;
      if (first.length === 0) {
        // Call VA with the agent's own VA not reachable: straight to everyone.
        if (next && startInviteRound(call, ctx, fx, input.agentId, next, ctx.settings.inviteSeconds)) return done;
        log(call, now, "invite_failed", "Nobody available to add");
        return done;
      }
      const seconds = cascade ? ctx.settings.inviteFirstSeconds : ctx.settings.inviteSeconds;
      startInviteRound(call, ctx, fx, input.agentId, first, seconds, next);
      return done;
    }

    case "invite_cancel":
      if (!call.inviting || call.inviting.byAgentId !== input.agentId) return unchanged;
      fx.push({ type: "stop_ringing", agentIds: call.inviting.ringingAgentIds });
      call.inviting = undefined;
      restoreMaxCall(call, ctx);
      log(call, now, "invite_cancelled");
      return done;

    case "participant_left":
      if (!call.participants?.includes(input.agentId)) return unchanged;
      removeParticipant(call, ctx, fx, input.agentId);
      return done;

    /* ---------- Agents answering / declining a transfer or an invite ---------- */
    case "agent_answered": {
      const a = input.agentId;
      if (t?.phase === "ringing" && t.ringingAgentIds.includes(a)) {
        if (!isAvailable(ctx, a)) return null; // step() just stops their ringing
        const others = t.ringingAgentIds.filter((x) => x !== a);
        if (others.length) fx.push({ type: "stop_ringing", agentIds: others });
        t.ringingAgentIds = [];
        t.answeredBy = a;
        fx.push({ type: "add_to_call", agentId: a });
        fx.push({ type: "set_presence", agentId: a, presence: "busy" });
        log(call, now, "transfer_answered", agentName(ctx, a));
        if (t.mode === "blind" || !t.byAgentId) completeTransfer(call, ctx, fx);
        else {
          t.phase = "consulting";
          restoreMaxCall(call, ctx);
        }
        return done;
      }
      if (call.inviting?.ringingAgentIds.includes(a)) {
        if (!canJoin(ctx, a)) return null;
        const others = call.inviting.ringingAgentIds.filter((x) => x !== a);
        if (others.length) fx.push({ type: "stop_ringing", agentIds: others });
        call.inviting = undefined;
        call.participants = [...(call.participants ?? []), a];
        fx.push({ type: "add_to_call", agentId: a });
        fx.push({ type: "set_presence", agentId: a, presence: "busy" });
        restoreMaxCall(call, ctx);
        log(call, now, "joined", agentName(ctx, a));
        return done;
      }
      return null;
    }

    case "agent_declined":
    case "agent_unavailable": {
      const a = input.agentId;
      if (t?.phase === "ringing" && t.ringingAgentIds.includes(a)) {
        t.ringingAgentIds = t.ringingAgentIds.filter((x) => x !== a);
        fx.push({ type: "stop_ringing", agentIds: [a] });
        log(call, now, "declined", agentName(ctx, a));
        if (t.ringingAgentIds.length === 0 && t.target.kind !== "external") {
          transferFailed(call, ctx, fx, "Nobody took the transfer");
        }
        return done;
      }
      if (call.inviting?.ringingAgentIds.includes(a)) {
        call.inviting.ringingAgentIds = call.inviting.ringingAgentIds.filter((x) => x !== a);
        fx.push({ type: "stop_ringing", agentIds: [a] });
        log(call, now, "declined", agentName(ctx, a));
        if (call.inviting.ringingAgentIds.length === 0) nextInviteRoundOrGiveUp(call, ctx, fx);
        return done;
      }
      return null;
    }

    /* ---------- Someone hangs up during a transfer or three-way call ---------- */
    case "agent_hung_up": {
      const a = input.agentId;
      if (call.participants?.includes(a)) {
        removeParticipant(call, ctx, fx, a);
        return done;
      }
      if (t?.phase === "consulting" && t.answeredBy === a) {
        // The target changed their mind: back to the agent who called them.
        fx.push({ type: "remove_from_call", agentId: a });
        fx.push({ type: "set_presence", agentId: a, presence: "available" });
        call.transfer = undefined;
        unholdCaller(call, fx);
        restoreMaxCall(call, ctx);
        log(call, now, "transfer_cancelled", `${agentName(ctx, a)} hung up`);
        return done;
      }
      if (t && t.byAgentId === a && call.state === "answered") {
        if (t.phase === "consulting") {
          // Hanging up after talking to the target = "you take it from here".
          completeTransfer(call, ctx, fx);
          return done;
        }
        // Hung up while the target still rings: hand it over blind.
        fx.push({ type: "remove_from_call", agentId: a });
        fx.push({ type: "set_presence", agentId: a, presence: "wrap_up" });
        t.byAgentId = undefined;
        t.mode = "blind";
        call.agentId = undefined;
        log(call, now, "agent_left", `${agentName(ctx, a)} left; the transfer carries on`);
        return done;
      }
      return null;
    }

    /* ---------- Deadlines ---------- */
    case "timer": {
      if (input.kind !== "transfer" && input.kind !== "invite" && input.kind !== "park") return null;
      if (!call.deadline || call.deadline.kind !== input.kind || now < call.deadline.at) return unchanged;
      if (input.kind === "transfer") {
        transferFailed(call, ctx, fx, `No answer in ${ctx.settings.transferSeconds}s`);
      } else if (input.kind === "invite") {
        if (call.inviting?.ringingAgentIds.length) {
          fx.push({ type: "stop_ringing", agentIds: call.inviting.ringingAgentIds });
        }
        nextInviteRoundOrGiveUp(call, ctx, fx);
      } else if (pastMaxCall(call, ctx)) {
        log(call, now, "safety_cap", "Call reached the maximum length");
        fx.push({ type: "hang_up_caller" });
        end(call, now, "timed_out", fx);
      } else {
        log(call, now, "park_timeout", `Parked ${Math.round(ctx.settings.parkSeconds / 60)} min: ringing the team`);
        ringHeldCall(call, ctx, fx);
      }
      return done;
    }

    default:
      return null;
  }
}

/** Who rings for a transfer; null when there is nobody to ring. */
function transferTargets(target: TransferTarget, fromAgentId: string, ctx: MachineContext): string[] | null {
  switch (target.kind) {
    case "agent":
      return target.agentId !== fromAgentId && isAvailable(ctx, target.agentId) ? [target.agentId] : null;
    case "queue": {
      const ids = ctx.agents
        .filter((a) => a.id !== fromAgentId && a.presence === "available" && a.queueIds.includes(ctx.settings.queue.id))
        .map((a) => a.id);
      return ids.length ? ids : null;
    }
    case "external":
      return [];
  }
}

function targetLabel(target: TransferTarget, ctx: MachineContext): string {
  if (target.kind === "agent") return agentName(ctx, target.agentId);
  if (target.kind === "queue") return ctx.settings.queue.name;
  return target.to;
}

function completeTransfer(call: Call, ctx: MachineContext, fx: Effect[]) {
  const t = call.transfer!;
  const original = t.byAgentId;
  const { now } = ctx;
  if (original) {
    fx.push({ type: "remove_from_call", agentId: original });
    fx.push({ type: "set_presence", agentId: original, presence: "wrap_up" });
  }
  call.transfer = undefined;

  if (t.target.kind === "external") {
    // We step out and leave the caller talking to the outside number.
    unholdCaller(call, fx);
    fx.push({ type: "release_to_external" });
    call.agentId = undefined; // wrap-up already set above
    log(call, now, "transferred", t.target.to);
    end(call, now, "transferred", fx);
    return;
  }

  call.agentId = t.answeredBy;
  unholdCaller(call, fx);
  restoreMaxCall(call, ctx);
  log(call, now, "transferred", agentName(ctx, t.answeredBy!));
}

function transferFailed(call: Call, ctx: MachineContext, fx: Effect[], why: string) {
  const agentStillOn = call.transfer?.byAgentId;
  clearSideLegs(call, fx);
  log(call, ctx.now, "transfer_failed", why);
  if (agentStillOn) {
    // "You still have the caller."
    unholdCaller(call, fx);
    restoreMaxCall(call, ctx);
    return;
  }
  // The agent already left: find someone else rather than drop the caller.
  if (pastMaxCall(call, ctx)) {
    fx.push({ type: "hang_up_caller" });
    end(call, ctx.now, "timed_out", fx);
    return;
  }
  ringHeldCall(call, ctx, fx);
}

function removeParticipant(call: Call, ctx: MachineContext, fx: Effect[], agentId: string) {
  fx.push({ type: "remove_from_call", agentId });
  fx.push({ type: "set_presence", agentId, presence: "wrap_up" });
  call.participants = call.participants?.filter((p) => p !== agentId);
  if (call.participants?.length === 0) call.participants = undefined;
  log(call, ctx.now, "left", agentName(ctx, agentId));
}

/* ---------- Adding someone: one round, or Call VA's two ---------- */

/** Old Call VA pool rule: someone available, or in wrap-up, can be asked to join. */
function canJoin(ctx: MachineContext, id: string): boolean {
  const p = ctx.agents.find((a) => a.id === id)?.presence;
  return p === "available" || p === "wrap_up";
}

/** Who from `ids` can be rung to join: not the agent, not already on the call, reachable. */
function joinable(call: Call, ctx: MachineContext, byAgentId: string, ids: string[]): string[] {
  const already = new Set([byAgentId, ...(call.participants ?? [])]);
  return [...new Set(ids)].filter((id) => !already.has(id) && canJoin(ctx, id));
}

/** Ring one round. Returns false when nobody in it can be rung. */
function startInviteRound(
  call: Call,
  ctx: MachineContext,
  fx: Effect[],
  byAgentId: string,
  ids: string[],
  seconds: number,
  nextRound?: string[],
): boolean {
  const ring = joinable(call, ctx, byAgentId, ids);
  if (ring.length === 0) return false;
  call.inviting = { byAgentId, ringingAgentIds: ring, startedAt: ctx.now, ...(nextRound && { nextRound }) };
  fx.push({ type: "ring", agentIds: ring });
  setDeadline(call, "invite", ctx.now, seconds);
  log(call, ctx.now, "inviting", ring.map((id) => agentName(ctx, id)).join(", "));
  return true;
}

/** The current round got no answer: ring the next one (everyone), or give up. */
function nextInviteRoundOrGiveUp(call: Call, ctx: MachineContext, fx: Effect[]) {
  const inv = call.inviting;
  call.inviting = undefined;
  if (inv?.nextRound && startInviteRound(call, ctx, fx, inv.byAgentId, inv.nextRound, ctx.settings.inviteSeconds)) return;
  restoreMaxCall(call, ctx);
  log(call, ctx.now, "invite_no_answer");
}