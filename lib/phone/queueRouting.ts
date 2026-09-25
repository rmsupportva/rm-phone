/**
 * Ringing a queue and what happens when nobody answers — the old phone's
 * queue rules. Order and strategy come from ringOrder.ts; this file rings,
 * moves on one person at a time, offers a callback when nobody is free, and
 * applies the queue's overflow.
 */
import {
  agentName,
  end,
  goToVoicemail,
  log,
  play,
  setDeadline,
  startRecording,
  startRinging,
  stopRinging,
  type MachineContext,
} from "./machineParts";
import type { PromptRef } from "./ivr";
import { queueById, ringOrder } from "./ringOrder";
import type { QueueSettings } from "./settings";
import type { Call, Effect } from "./types";

/** Ring the queue: everyone at once, or one at a time (see ringOrder.ts). */
export function enterQueue(call: Call, ctx: MachineContext, fx: Effect[], queue: QueueSettings = ctx.settings.queue) {
  call.queueId = queue.id;
  call.menuStep = undefined;
  call.menu = undefined;
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

  // Old phone: the queue conference records from the start, notice first.
  startRecording(call, ctx, fx, true);
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
export function ringNext(call: Call, ctx: MachineContext, fx: Effect[]): boolean {
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
 * in the old phone — voicemail (default), a goodbye, or one other queue.
 */
export function overflow(call: Call, ctx: MachineContext, fx: Effect[]) {
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
  // voicemail — also when a second queue would have to overflow to a third.
  goToVoicemail(call, ctx, fx, "all_busy");
}

/** The caller asked to be called back: save it, thank them, end the call (old phone: completed). */
export function requestCallback(
  call: Call,
  ctx: MachineContext,
  fx: Effect[],
  source: "caller_requested" | "menu" = "caller_requested",
  confirmation: PromptRef = "callback_confirmed",
) {
  fx.push({ type: "create_callback", source, from: call.from, lang: call.lang });
  play(fx, confirmation, call.lang);
  fx.push({ type: "hang_up_caller" });
  log(call, ctx.now, "callback_requested", source === "menu" ? "Chose a callback in the menu" : "Pressed 1: call me back");
  end(call, ctx.now, "completed", fx);
}
