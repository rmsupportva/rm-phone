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
  goToVoicemail,
  setDeadline,
  startRecording,
  unholdCaller,
  type MachineContext,
  type StepResult,
} from "./machineParts";
import { menuDialFailed, menuInput, menuTimeout, routeNewCall } from "./menuRunner";
import { overflow, requestCallback, ringNext } from "./queueRouting";
import type { Call, CallInput, Effect, TimerKind } from "./types";

export { END_REASON_LABEL, type MachineContext, type StepResult };

/* ---------- Starting a call ---------- */

/**
 * `preferredAgentId`: who should ring first if free — the dialed number's own
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
  // Hours, the number's routing and the phone menu: see menuRunner.ts.
  routeNewCall(call, ctx, fx);
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
  const result = stepCall(current, input, ctx);
  if (current.state !== "ended" && result.call.state === "ended") {
    const ended = result.call;
    // After-call rating text, the moment an answered incoming call ends.
    if (feedbackDue(ended, ctx)) result.effects.push({ type: "send_feedback_text", to: ended.from, lang: ended.lang });
    // Nobody talked to them: onto the callback list, so someone calls back.
    if (ctx.settings.missedCallbacks && ended.direction === "inbound" && (ended.endReason === "missed" || ended.endReason === "voicemail")) {
      result.effects.push({ type: "create_callback", source: ended.endReason, from: ended.from, lang: ended.lang });
    }
  }
  return result;
}

/** Old phone: only answered incoming calls with at least 15 s of talk. */
const FEEDBACK_MIN_TALK_SECONDS = 15;

function feedbackDue(call: Call, ctx: MachineContext): boolean {
  return (
    Boolean(ctx.settings.postCallFeedback) &&
    call.direction === "inbound" &&
    call.endReason === "completed" &&
    (call.talkSeconds ?? 0) >= FEEDBACK_MIN_TALK_SECONDS
  );
}

function stepCall(current: Call, input: CallInput, ctx: MachineContext): StepResult {
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
      if (!call.menu) return unchanged;
      menuInput(call, ctx, fx, { digits: digit });
      return { call, effects: fx };
    }

    case "caller_spoke": {
      if (call.state !== "menu" || !call.menu) return unchanged;
      menuInput(call, ctx, fx, { speech: { text: input.text, confidence: input.confidence } });
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
      call.ivrDial = undefined;
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
        if (call.ivrDial) {
          menuDialFailed(call, ctx, fx, "Declined");
        } else if (call.answeredAt !== undefined) {
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
          if (call.ivrDial?.external) fx.push({ type: "hang_up_external" });
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
      startRecording(call, ctx, fx, false); // old phone: outbound records with no notice
      return { call, effects: fx };
    }

    // A menu "dial" step to an outside number (transfers are handled in inCall.ts).
    case "external_answered": {
      if (call.state !== "ringing" || !call.ivrDial?.external) return unchanged;
      log(call, now, "transferred", call.ivrDial.external);
      fx.push({ type: "release_to_external" });
      call.ivrDial = undefined;
      end(call, now, "transferred", fx);
      return { call, effects: fx };
    }

    case "external_failed":
    case "external_hung_up": {
      if (call.state !== "ringing" || !call.ivrDial?.external) return unchanged;
      menuDialFailed(call, ctx, fx, "The number couldn't be reached");
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
      menuTimeout(call, ctx, fx);
      return;
    case "ring":
      if (advanceRing(call, ctx, fx)) return; // an own-phone forward fell due; still ringing
      if (call.ivrDial) {
        menuDialFailed(call, ctx, fx, "Nobody answered");
        return;
      }
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
