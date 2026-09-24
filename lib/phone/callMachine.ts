/**
 * The call brain: one pure function decides what happens to a call next.
 *
 * `step(call, input, ctx)` never talks to the outside world. It returns the
 * new call plus a list of effects (ring these agents, play this prompt, hang
 * up…) for the engine to carry out. Because every change goes through here,
 * one input at a time, two things can never both "win": an answer that lands
 * a moment before the ring timer means the timer finds the call already
 * answered and does nothing.
 *
 * Getting a call answered lives here; what agents do during a call (hold,
 * park, transfer, adding a VA) lives in inCall.ts.
 *
 * Safety rules (lessons from the old system):
 *  1. Every state except `ended` has a deadline, so no call stays open.
 *  2. A call that was answered never goes to voicemail and is never "missed".
 *  3. A timer only fires if it still matches the call's current deadline;
 *     stale timers are ignored.
 *  4. Hanging up during the voicemail greeting is a missed call to return,
 *     not an empty voicemail.
 *  5. When the last ringing agent declines, the caller goes to voicemail
 *     straight away instead of listening to ringing nobody will answer.
 */
import { evaluateHours } from "./hours";
import { stepInCall } from "./inCall";
import {
  END_REASON_LABEL,
  advanceRing,
  agentName,
  armRingDeadline,
  cloneCall,
  end,
  log,
  parkCall,
  pastMaxCall,
  play,
  setDeadline,
  startRinging,
  stopRinging,
  unholdCaller,
  type MachineContext,
  type StepResult,
} from "./machineParts";
import { queueById, ringOrder } from "./ringOrder";
import type { QueueSettings } from "./settings";
import type { Call, CallInput, Effect, Lang, PromptId, TimerKind } from "./types";

export { END_REASON_LABEL, type MachineContext, type StepResult };

/* ---------- Starting a call ---------- */

/**
 * `preferredAgentId`: who should ring first if free â€” the dialed number's own
 * agent, else the agent this caller last spoke with (old phone: assigned agent
 * beats caller history). The webhook works it out; the engine applies it.
 */
export function startInbound(
  id: string,
  from: string,
  ctx: MachineContext,
  opts: { preferredAgentId?: string } = {},
): StepResult {
  const call: Call = {
    id,
    direction: "inbound",
    from,
    to: ctx.settings.mainNumber,
    state: "menu",
    lang: "en",
    startedAt: ctx.now,
    ringingAgentIds: [],
    declinedAgentIds: [],
    timeline: [],
    ...(opts.preferredAgentId && { preferredAgentId: opts.preferredAgentId }),
  };
  const fx: Effect[] = [];
  log(call, ctx.now, "received");

  const hours = evaluateHours(ctx.now, ctx.settings.hours);
  call.hoursState = hours.state;
  log(call, ctx.now, "hours_checked", hours.label);

  if (hours.state !== "open") {
    const prompt: PromptId =
      hours.state === "holiday" ? "holiday" : hours.state === "early_close" ? "early_close" : "closed";
    goToVoicemail(call, ctx, fx, prompt);
    return { call, effects: fx };
  }

  call.menuStep = "language";
  play(fx, "welcome_language", call.lang);
  setDeadline(call, "menu", ctx.now, ctx.settings.menuSeconds);
  log(call, ctx.now, "menu", "Language menu");
  return { call, effects: fx };
}

/**
 * `agentCell`: the agent calls from their own phone (old phone: outbound_via
 * = cell). Their phone rings first; the other side is dialled only once it is
 * answered, never alongside it. If they never answer, nobody else is rung.
 */
export function startOutbound(
  id: string,
  agentId: string,
  to: string,
  ctx: MachineContext,
  opts: { agentCell?: string } = {},
): StepResult {
  const call: Call = {
    id,
    direction: "outbound",
    from: ctx.settings.mainNumber,
    to,
    state: "dialing",
    lang: "en",
    startedAt: ctx.now,
    agentId,
    ringingAgentIds: [],
    declinedAgentIds: [],
    timeline: [],
  };
  const fx: Effect[] = [{ type: "set_presence", agentId, presence: "busy" }];
  if (opts.agentCell) {
    call.dialPhase = "agent";
    fx.push({ type: "dial_agent_cell", agentId, to: opts.agentCell });
    log(call, ctx.now, "dialing", "Ringing your own phone first");
  } else {
    fx.push({ type: "dial", to });
    log(call, ctx.now, "dialing");
  }
  setDeadline(call, "dial", ctx.now, ctx.settings.dialSeconds);
  return { call, effects: fx };
}

/* ---------- The one place a call changes ---------- */

export function step(current: Call, input: CallInput, ctx: MachineContext): StepResult {
  const call = cloneCall(current);
  const fx: Effect[] = [];
  const unchanged: StepResult = { call: current, effects: [] };
  const { now } = ctx;

  const inCall = stepInCall(current, call, input, ctx, fx);
  if (inCall) return inCall;

  switch (input.type) {
    case "recording_ready": {
      call.recording = input.recording;
      call.transcript = input.transcript;
      log(call, now, "recording_saved", `${input.recording.seconds}s`);
      return { call, effects: fx };
    }

    case "timer": {
      if (!call.deadline || call.deadline.kind !== input.kind || now < call.deadline.at) {
        return unchanged; // stale or early timer
      }
      onTimer(call, input.kind, ctx, fx);
      return { call, effects: fx };
    }

    case "caller_pressed": {
      if (call.state !== "menu") return unchanged;
      const digit = input.digit;
      if (call.menuStep === "callback_offer") {
        if (digit === "1") requestCallback(call, ctx, fx);
        else {
          log(call, now, "menu_choice", `Pressed ${digit}: no callback`);
          goToVoicemail(call, ctx, fx);
        }
        return { call, effects: fx };
      }
      if (call.menuStep === "language") {
        if (digit !== "1" && digit !== "2") {
          log(call, now, "menu_invalid_key", digit);
          return { call, effects: fx };
        }
        chooseLanguage(call, digit === "2" ? "es" : "en", ctx, fx, `Pressed ${digit}`);
        return { call, effects: fx };
      }
      if (digit === "1") {
        log(call, now, "menu_choice", "Pressed 1: speak with someone");
        enterQueue(call, ctx, fx);
      } else if (digit === "2") {
        log(call, now, "menu_choice", "Pressed 2: leave a message");
        goToVoicemail(call, ctx, fx);
      } else {
        log(call, now, "menu_invalid_key", digit);
      }
      return { call, effects: fx };
    }

    case "agent_answered": {
      if (call.state === "dialing" && call.dialPhase === "agent") {
        if (input.agentId !== call.agentId) return unchanged;
        call.dialPhase = "family";
        fx.push({ type: "dial", to: call.to });
        setDeadline(call, "dial", now, ctx.settings.dialSeconds);
        log(call, now, "agent_cell_answered", "Your phone answered: calling them now");
        return { call, effects: fx };
      }
      const agent = ctx.agents.find((a) => a.id === input.agentId);
      const canAnswer =
        call.state === "ringing" &&
        call.ringingAgentIds.includes(input.agentId) &&
        agent?.presence === "available";
      if (!canAnswer) {
        // Too late (someone else answered, or the caller already left):
        // just make sure this agent's phone stops ringing.
        return { call: current, effects: [{ type: "stop_ringing", agentIds: [input.agentId] }] };
      }
      const others = call.ringingAgentIds.filter((a) => a !== input.agentId);
      if (others.length) fx.push({ type: "stop_ringing", agentIds: others });
      const pickedUpAgain = call.answeredAt !== undefined; // a parked / handed-off caller
      call.ringingAgentIds = [];
      call.pendingForwards = undefined;
      call.ringEndsAt = undefined;
      call.ringPlan = undefined;
      call.state = "answered";
      call.answeredAt ??= now;
      call.agentId = input.agentId;
      call.parkedBy = undefined;
      call.parkedAt = undefined;
      unholdCaller(call, fx);
      fx.push({ type: "connect", agentId: input.agentId });
      fx.push({ type: "set_presence", agentId: input.agentId, presence: "busy" });
      call.deadline = { kind: "max_call", at: Math.max(now, call.answeredAt + ctx.settings.maxCallSeconds * 1000) };
      log(call, now, pickedUpAgain ? "picked_up" : "answered", agent?.name);
      return { call, effects: fx };
    }

    case "agent_declined":
    case "agent_unavailable": {
      if (call.state === "dialing" && call.dialPhase === "agent" && input.agentId === call.agentId) {
        log(call, now, "hung_up", "Your phone was declined: nobody else was called");
        end(call, now, "cancelled", fx);
        return { call, effects: fx };
      }
      if (call.state !== "ringing" || !call.ringingAgentIds.includes(input.agentId)) {
        return unchanged;
      }
      call.ringingAgentIds = call.ringingAgentIds.filter((a) => a !== input.agentId);
      call.declinedAgentIds.push(input.agentId);
      if (call.pendingForwards) {
        const left = call.pendingForwards.filter((f) => f.agentId !== input.agentId);
        call.pendingForwards = left.length ? left : undefined;
        if (call.ringingAgentIds.length) armRingDeadline(call);
      }
      fx.push({ type: "stop_ringing", agentIds: [input.agentId] });
      const name = ctx.agents.find((a) => a.id === input.agentId)?.name ?? input.agentId;
      log(call, now, input.type === "agent_declined" ? "declined" : "agent_left", name);
      if (call.ringingAgentIds.length === 0) {
        if (call.answeredAt !== undefined) {
          log(call, now, "nobody_left_ringing");
          parkCall(call, ctx, fx);
        } else if (!ringNext(call, ctx, fx)) {
          log(call, now, "nobody_left_ringing");
          overflow(call, ctx, fx);
        }
      }
      return { call, effects: fx };
    }

    case "caller_hung_up": {
      const who = call.direction === "inbound" ? "Caller" : "Other side";
      const talked = call.answeredAt !== undefined;
      switch (call.state) {
        case "menu":
          log(call, now, "hung_up", `${who} hung up in the menu`);
          end(call, now, "abandoned_menu", fx);
          break;
        case "ringing":
          log(call, now, "hung_up", `${who} hung up while ${talked ? "on hold" : "ringing"}`);
          end(call, now, talked ? "completed" : "missed", fx);
          break;
        case "parked":
          log(call, now, "hung_up", `${who} hung up while parked`);
          end(call, now, "completed", fx);
          break;
        case "voicemail":
          log(call, now, "hung_up", `${who} hung up before leaving a message`);
          end(call, now, "missed", fx);
          break;
        case "dialing":
          if (call.dialPhase === "agent") return unchanged; // the other side hasn't been dialled yet
          log(call, now, "hung_up", "Other side rejected the call");
          end(call, now, "no_answer", fx);
          break;
        case "answered":
          log(call, now, "hung_up", `${who} hung up`);
          if (call.agentId) fx.push({ type: "hang_up_agent", agentId: call.agentId });
          end(call, now, "completed", fx);
          break;
        case "ended":
          return unchanged;
      }
      return { call, effects: fx };
    }

    case "agent_hung_up": {
      if (call.agentId !== input.agentId) return unchanged;
      if (call.state === "answered") {
        log(call, now, "hung_up", "Agent hung up");
        fx.push({ type: "hang_up_caller" });
        end(call, now, "completed", fx);
      } else if (call.state === "dialing") {
        log(call, now, "hung_up", "Agent cancelled before an answer");
        if (call.dialPhase !== "agent") fx.push({ type: "hang_up_caller" });
        end(call, now, "cancelled", fx);
      } else {
        return unchanged;
      }
      return { call, effects: fx };
    }

    case "voicemail_saved": {
      if (call.state !== "voicemail") return unchanged;
      if (input.recording.seconds < 1) {
        log(call, now, "voicemail_empty");
        end(call, now, "missed", fx);
      } else {
        call.voicemail = input.recording;
        if (input.transcript) call.transcript = input.transcript;
        log(call, now, "voicemail_saved", `${input.recording.seconds}s`);
        end(call, now, "voicemail", fx);
      }
      fx.push({ type: "hang_up_caller" });
      return { call, effects: fx };
    }

    case "far_end_answered": {
      if (call.state !== "dialing" || call.dialPhase === "agent") return unchanged;
      call.state = "answered";
      call.answeredAt = now;
      setDeadline(call, "max_call", now, ctx.settings.maxCallSeconds);
      log(call, now, "answered", "Other side picked up");
      return { call, effects: fx };
    }

    case "far_end_failed": {
      if (call.state !== "dialing" || call.dialPhase === "agent") return unchanged;
      log(call, now, "failed", "The call could not be placed");
      end(call, now, "failed", fx);
      return { call, effects: fx };
    }

    default:
      // In-call inputs that did not apply to this call (e.g. "hold" on a call
      // that is still ringing) change nothing.
      return unchanged;
  }
}

/* ---------- Transitions ---------- */

function onTimer(call: Call, kind: TimerKind, ctx: MachineContext, fx: Effect[]) {
  const { now } = ctx;
  switch (kind) {
    case "menu":
      if (call.menuStep === "callback_offer") {
        log(call, now, "menu_choice", "No key pressed: leave a message");
        goToVoicemail(call, ctx, fx);
        return;
      }
      if (call.menuStep === "language") {
        chooseLanguage(call, "en", ctx, fx, "No key pressed: English");
      } else {
        log(call, now, "menu_choice", "No key pressed: speak with someone");
        enterQueue(call, ctx, fx);
      }
      return;
    case "ring":
      if (advanceRing(call, ctx, fx)) return; // an own-phone forward fell due; still ringing
      if (call.answeredAt !== undefined) {
        // Someone already talked to this caller: never voicemail. Park them.
        if (pastMaxCall(call, ctx)) {
          log(call, now, "safety_cap", "Call reached the maximum length");
          fx.push({ type: "hang_up_caller" });
          end(call, now, "timed_out", fx);
        } else {
          log(call, now, "ring_no_answer", "Nobody took the call: parked again");
          parkCall(call, ctx, fx);
        }
        return;
      }
      if (ringNext(call, ctx, fx)) return; // one-at-a-time: the next person rings
      log(call, now, "ring_no_answer", "Nobody answered");
      overflow(call, ctx, fx);
      return;
    case "voicemail":
      log(call, now, "voicemail_timeout", "No message was saved");
      fx.push({ type: "hang_up_caller" });
      end(call, now, "missed", fx);
      return;
    case "dial":
      if (call.dialPhase === "agent") {
        log(call, now, "no_answer", "Your phone wasn't answered: nobody else was called");
        if (call.agentId) fx.push({ type: "hang_up_agent", agentId: call.agentId });
        end(call, now, "cancelled", fx);
        return;
      }
      log(call, now, "no_answer", "Nobody picked up");
      fx.push({ type: "hang_up_caller" });
      end(call, now, "no_answer", fx);
      return;
    case "max_call":
      log(call, now, "safety_cap", "Call reached the maximum length");
      fx.push({ type: "hang_up_caller" });
      if (call.agentId) fx.push({ type: "hang_up_agent", agentId: call.agentId });
      end(call, now, "timed_out", fx);
      return;
    // transfer / invite / park deadlines are handled in inCall.ts.
    case "transfer":
    case "invite":
    case "park":
      return;
  }
}

function chooseLanguage(call: Call, lang: Lang, ctx: MachineContext, fx: Effect[], detail: string) {
  call.lang = lang;
  call.menuStep = "main";
  log(call, ctx.now, "language", `${lang === "es" ? "Spanish" : "English"} (${detail})`);
  play(fx, "main_menu", lang);
  setDeadline(call, "menu", ctx.now, ctx.settings.menuSeconds);
}

/** Ring the queue: everyone at once, or one at a time (see ringOrder.ts). */
function enterQueue(call: Call, ctx: MachineContext, fx: Effect[], queue: QueueSettings = ctx.settings.queue) {
  call.queueId = queue.id;
  call.menuStep = undefined;
  const plan = ringOrder(call, queue, ctx);
  const targets = plan.order;
  if (plan.rotate) fx.push({ type: "advance_rotation", queueId: queue.id, memberCount: targets.length });
  if (plan.languageOrdered) log(call, ctx.now, "language_ordered", "Spanish speakers first");
  if (plan.preferred) {
    const who = agentName(ctx, call.preferredAgentId!);
    const why = { moved: `${who} rings first`, not_available: `${who} isn't available`, language: `${who} doesn't speak Spanish` };
    log(call, ctx.now, "preferred_agent", why[plan.preferred]);
  }

  if (targets.length === 0) {
    log(call, ctx.now, "nobody_available", `No one available in ${queue.name}`);
    if (queue.callbackOffer) {
      // Old phone: "press 1 for a callback", one key, 6 seconds.
      call.state = "menu";
      call.menuStep = "callback_offer";
      play(fx, "callback_offer", call.lang);
      setDeadline(call, "menu", ctx.now, ctx.settings.callbackOfferSeconds);
      log(call, ctx.now, "menu", "Callback offer");
      return;
    }
    overflow(call, ctx, fx);
    return;
  }

  play(fx, "please_hold", call.lang);
  if (plan.strategy === "ring_all") {
    startRinging(call, ctx, fx, targets, queue.ringSeconds);
    log(call, ctx.now, "ringing", `${targets.length} agent${targets.length === 1 ? "" : "s"}`);
    return;
  }
  startRinging(call, ctx, fx, [targets[0]], queue.ringSeconds);
  call.ringPlan = { queueId: queue.id, order: targets, next: 1 };
  log(call, ctx.now, "ringing", `${agentName(ctx, targets[0])} (1 of ${targets.length})`);
}

/**
 * One-at-a-time ringing: stop whoever is ringing and ring the next person on
 * the list who is still available and hasn't declined. False when the list is
 * used up (or the queue rings everyone at once).
 */
function ringNext(call: Call, ctx: MachineContext, fx: Effect[]): boolean {
  const plan = call.ringPlan;
  if (!plan) return false;
  const queue = queueById(ctx, plan.queueId) ?? ctx.settings.queue;
  let i = plan.next;
  while (i < plan.order.length) {
    const id = plan.order[i++];
    const a = ctx.agents.find((x) => x.id === id);
    if (a?.presence === "available" && !call.declinedAgentIds.includes(id)) {
      stopRinging(call, fx);
      startRinging(call, ctx, fx, [id], queue.ringSeconds);
      call.ringPlan = { ...plan, next: i };
      log(call, ctx.now, "ringing", `${a.name} (${i} of ${plan.order.length})`);
      return true;
    }
  }
  return false;
}

/**
 * Nobody answered (or nobody could be rung): the queue's overflow action, as
 * in the old phone â€” voicemail (default), a goodbye, or one other queue.
 */
function overflow(call: Call, ctx: MachineContext, fx: Effect[]) {
  const queue = queueById(ctx, call.queueId) ?? ctx.settings.queue;
  const action = queue.overflow?.action ?? "voicemail";
  const target = queueById(ctx, queue.overflow?.queueId);
  if (action === "queue" && target && target.id !== queue.id && !call.overflowed) {
    stopRinging(call, fx);
    call.overflowed = true;
    call.declinedAgentIds = [];
    log(call, ctx.now, "overflow", `To ${target.name}`);
    enterQueue(call, ctx, fx, target);
    return;
  }
  if (action === "hangup") {
    stopRinging(call, fx);
    play(fx, "no_agents", call.lang);
    fx.push({ type: "hang_up_caller" });
    log(call, ctx.now, "overflow", "Nobody available: goodbye");
    end(call, ctx.now, "missed", fx);
    return;
  }
  // voicemail â€” also when a second queue would have to overflow to a third.
  goToVoicemail(call, ctx, fx, "all_busy");
}

/** The caller asked to be called back: save it, thank them, end the call (old phone: completed). */
function requestCallback(call: Call, ctx: MachineContext, fx: Effect[]) {
  fx.push({ type: "create_callback", source: "caller_requested", from: call.from, lang: call.lang });
  play(fx, "callback_confirmed", call.lang);
  fx.push({ type: "hang_up_caller" });
  log(call, ctx.now, "callback_requested", "Pressed 1: call me back");
  end(call, ctx.now, "completed", fx);
}

function goToVoicemail(call: Call, ctx: MachineContext, fx: Effect[], reason?: PromptId) {
  stopRinging(call, fx);
  call.state = "voicemail";
  call.menuStep = undefined;
  if (reason) play(fx, reason, call.lang);
  play(fx, "voicemail_greeting", call.lang);
  fx.push({ type: "record_voicemail", maxSeconds: ctx.settings.voicemailMaxSeconds });
  // Greeting + longest message + a little grace for the carrier to report back.
  const seconds = ctx.settings.voicemailGreetingSeconds + ctx.settings.voicemailMaxSeconds + 15;
  setDeadline(call, "voicemail", ctx.now, seconds);
  log(call, ctx.now, "voicemail");
}

/** Calls someone should return: the caller reached out and nobody talked to them. */
export function needsCallback(call: Call): boolean {
  return (
    call.direction === "inbound" &&
    call.state === "ended" &&
    (call.endReason === "missed" ||
      call.endReason === "voicemail" ||
      call.endReason === "abandoned_menu")
  );
}
