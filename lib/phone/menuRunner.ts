/**
 * Running an inbound call's first moments: the number's routing, closing time,
 * and the phone menu (ivr.ts) step by step.
 *
 * Steps that don't need the caller (play, language, hours, agent check, text)
 * run straight through; a menu waits for a key or words; queue / voicemail /
 * callback / dial / hangup hand the call on. Every step counts towards the
 * 25-step limit, so a badly built menu can't trap a caller.
 */
import { evaluateHours } from "./hours";
import {
  DEFAULT_DIAL_SECONDS,
  DEFAULT_MENU_SECONDS,
  MAX_IVR_STEPS,
  defaultFlow,
  flowHasHoursStep,
  matchOption,
  nodeById,
  type IvrFlow,
  type IvrNode,
} from "./ivr";
import {
  goToVoicemail,
  log,
  play,
  sayGoodbye,
  setDeadline,
  startRinging,
  stopRinging,
  type MachineContext,
} from "./machineParts";
import { enterQueue, requestCallback } from "./queueRouting";
import { queueById } from "./ringOrder";
import type { Call, Effect, PromptId } from "./types";

export function flowFor(ctx: MachineContext): IvrFlow {
  return ctx.settings.ivr ?? defaultFlow(ctx.settings.queue.id, ctx.settings.menuSeconds);
}

/**
 * A new inbound call: check the hours, then do what the number is set to do.
 * Closed/holiday applies the after-hours action — unless the menu has its own
 * "hours" step, which then decides (old phone rule).
 */
export function routeNewCall(call: Call, ctx: MachineContext, fx: Effect[]) {
  const routing = ctx.settings.routing ?? "ivr";
  const flow = flowFor(ctx);
  const hours = evaluateHours(ctx.now, ctx.settings.hours);
  call.hoursState = hours.state;
  log(call, ctx.now, "hours_checked", hours.label);

  if (hours.state !== "open" && !(routing === "ivr" && flowHasHoursStep(flow))) {
    const closedPrompt: PromptId = hours.state === "holiday" ? "holiday" : hours.state === "early_close" ? "early_close" : "closed";
    const after = ctx.settings.afterHours ?? { action: "voicemail" as const };
    if (after.action === "hangup") return sayGoodbye(call, ctx, fx, "goodbye", "completed", "Closed: goodbye");
    if (after.action === "queue") return enterQueue(call, ctx, fx, queueById(ctx, after.queueId) ?? ctx.settings.queue);
    return goToVoicemail(call, ctx, fx, closedPrompt);
  }

  switch (routing) {
    case "queue":
      return enterQueue(call, ctx, fx);
    case "voicemail":
      return goToVoicemail(call, ctx, fx);
    case "hangup":
      return sayGoodbye(call, ctx, fx, "goodbye", "completed", "This number doesn't take calls");
    case "ivr":
      return runFlow(call, ctx, fx, flow.rootId);
  }
}

/** Walk the menu from `nodeId` until the caller has to act or the call is handed on. */
export function runFlow(call: Call, ctx: MachineContext, fx: Effect[], nodeId: string) {
  const flow = flowFor(ctx);
  let id: string | undefined = nodeId;
  while (id !== undefined) {
    call.ivrSteps = (call.ivrSteps ?? 0) + 1;
    const node = nodeById(flow, id);
    if (!node || call.ivrSteps > MAX_IVR_STEPS) {
      return sayGoodbye(call, ctx, fx, "error_goodbye", "missed", node ? "Too many menu steps" : `Missing menu step "${id}"`);
    }
    id = runNode(call, ctx, fx, node);
  }
}

/** Run one step; returns the next step to run straight away, or undefined to stop. */
function runNode(call: Call, ctx: MachineContext, fx: Effect[], node: IvrNode): string | undefined {
  const { now } = ctx;
  switch (node.type) {
    case "menu": {
      call.state = "menu";
      call.menuStep = undefined;
      const hints = flowFor(ctx).speech ? node.options.flatMap((o) => o.keywords ?? []) : [];
      call.menu = {
        nodeId: node.id,
        ...(node.prompt && { prompt: node.prompt }),
        maxDigits: node.maxDigits ?? 1,
        ...(hints.length && { speechHints: hints }),
      };
      if (node.prompt) play(fx, node.prompt, call.lang);
      setDeadline(call, "menu", now, Math.max(2, node.timeoutSec ?? DEFAULT_MENU_SECONDS));
      log(call, now, "menu", node.id);
      return undefined;
    }
    case "play":
      play(fx, node.prompt, call.lang);
      if (node.next) return node.next;
      sayGoodbye(call, ctx, fx, undefined, "completed", "End of the menu");
      return undefined;
    case "set_language":
      call.lang = node.lang;
      log(call, now, "language", node.lang === "es" ? "Spanish" : "English");
      return node.next;
    case "hours": {
      const h = evaluateHours(now, ctx.settings.hours);
      log(call, now, "hours_checked", h.label);
      if (h.state === "open") return node.open;
      if (h.state === "holiday") return node.holiday ?? node.closed;
      return node.closed;
    }
    case "agent_check": {
      // Old rule: a Spanish caller needs someone who speaks Spanish.
      const someone = ctx.agents.some(
        (a) => a.presence === "available" && a.queueIds.includes(node.queueId) && (call.lang !== "es" || a.speaksSpanish),
      );
      log(call, now, "agent_check", someone ? "Someone is free" : "Nobody free");
      return someone ? node.available : node.unavailable;
    }
    case "queue":
      enterQueue(call, ctx, fx, queueById(ctx, node.queueId) ?? ctx.settings.queue);
      return undefined;
    case "voicemail":
      goToVoicemail(call, ctx, fx, undefined, node.greeting);
      return undefined;
    case "callback":
      requestCallback(call, ctx, fx, "menu", node.prompt ?? "callback_menu_confirmed");
      return undefined;
    case "send_sms":
      fx.push({ type: "send_sms", to: call.from, body: node.message });
      log(call, now, "text_sent");
      if (node.next) return node.next;
      sayGoodbye(call, ctx, fx, "sms_sent", "completed", "Sent a text");
      return undefined;
    case "dial": {
      if (node.prompt) play(fx, node.prompt, call.lang);
      const seconds = Math.min(120, Math.max(5, node.timeoutSec ?? DEFAULT_DIAL_SECONDS));
      call.menu = undefined;
      if (node.to.kind === "agent") {
        call.ivrDial = { ...(node.noAnswer && { noAnswer: node.noAnswer }) };
        startRinging(call, ctx, fx, [node.to.agentId], seconds);
        log(call, now, "ringing", `Menu: ${node.to.agentId}`);
      } else {
        call.ivrDial = { external: node.to.number, ...(node.noAnswer && { noAnswer: node.noAnswer }) };
        call.state = "ringing";
        call.ringingAgentIds = [];
        call.ringEndsAt = now + seconds * 1000;
        setDeadline(call, "ring", now, seconds);
        fx.push({ type: "dial_external", to: node.to.number });
        log(call, now, "dialing", `Menu: ${node.to.number}`);
      }
      return undefined;
    }
    case "hangup":
      sayGoodbye(call, ctx, fx, undefined, "completed", "Menu hang-up");
      return undefined;
  }
}

/** A key (or words) at a menu. No match → the menu's default, or the menu again. */
export function menuInput(call: Call, ctx: MachineContext, fx: Effect[], input: { digits?: string; speech?: { text: string; confidence: number } }) {
  const node = nodeById(flowFor(ctx), call.menu?.nodeId);
  if (!node || node.type !== "menu") return;
  const option = matchOption(node, input);
  const said = input.digits !== undefined ? `Pressed ${input.digits}` : `Said "${input.speech?.text ?? ""}"`;
  if (option) {
    log(call, ctx.now, "menu_choice", said);
    return runFlow(call, ctx, fx, option.next);
  }
  log(call, ctx.now, "menu_invalid_key", said);
  runFlow(call, ctx, fx, node.defaultNext ?? node.id);
}

/** No key before the menu's time ran out: its default, or the menu again. */
export function menuTimeout(call: Call, ctx: MachineContext, fx: Effect[]) {
  const node = nodeById(flowFor(ctx), call.menu?.nodeId);
  if (!node || node.type !== "menu") return;
  log(call, ctx.now, "menu_choice", "No key pressed");
  runFlow(call, ctx, fx, node.defaultNext ?? node.id);
}

/** A menu "dial" step got no answer (or failed): its no-answer step, else "nobody available". */
export function menuDialFailed(call: Call, ctx: MachineContext, fx: Effect[], why: string) {
  const dial = call.ivrDial;
  if (dial?.external) fx.push({ type: "hang_up_external" });
  stopRinging(call, fx);
  call.ivrDial = undefined;
  log(call, ctx.now, "ring_no_answer", why);
  if (dial?.noAnswer) return runFlow(call, ctx, fx, dial.noAnswer);
  sayGoodbye(call, ctx, fx, "no_agents", "missed", "Nobody available");
}
