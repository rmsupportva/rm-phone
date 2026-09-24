/**
 * Who rings, and in what order — the old phone's rules (rm-telephony
 * queueRouting.ts / dialPlan.ts):
 *
 *  1. Eligible = in the queue, available, and hasn't declined this call.
 *  2. Base order: priority (lower first), then id. "longest_idle" puts whoever
 *     has been free longest first.
 *  3. "round_robin" starts one further along each call (the queue's rotation
 *     pointer moves on by one; needs at least 2 people).
 *  4. A Spanish caller: Spanish speakers first, keeping their order; the rest
 *     still ring after them.
 *  5. The preferred agent (the number's own agent, else the caller's last
 *     agent) moves to the very front — only if they are eligible, and not for
 *     a Spanish caller when they don't speak Spanish.
 *
 * For ring_all everyone rings at once, so the order only matters for the log.
 */
import type { MachineContext } from "./machineParts";
import type { QueueSettings, RingStrategy } from "./settings";
import type { Agent, Call } from "./types";

export interface RingOrder {
  order: string[];
  strategy: RingStrategy;
  /** Round robin moved the starting point: tell the store to advance it. */
  rotate: boolean;
  /** Why the preferred agent did or didn't move to the front, for the call's log. */
  preferred?: "moved" | "not_available" | "language";
  languageOrdered: boolean;
}

export function queueById(ctx: MachineContext, id: string | undefined): QueueSettings | undefined {
  if (!id) return undefined;
  if (ctx.settings.queue.id === id) return ctx.settings.queue;
  return ctx.settings.otherQueues?.find((q) => q.id === id);
}

export function ringOrder(call: Call, queue: QueueSettings, ctx: MachineContext): RingOrder {
  const strategy: RingStrategy = queue.strategy ?? "ring_all";
  const eligible = ctx.agents.filter(
    (a) => a.presence === "available" && a.queueIds.includes(queue.id) && !call.declinedAgentIds.includes(a.id),
  );

  let people: Agent[] = [...eligible].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  if (strategy === "longest_idle") {
    people.sort((a, b) => (a.idleSince ?? Infinity) - (b.idleSince ?? Infinity));
  }

  let rotate = false;
  if (strategy === "round_robin" && people.length >= 2) {
    const start = (ctx.rotation?.[queue.id] ?? 0) % people.length;
    people = [...people.slice(start), ...people.slice(0, start)];
    rotate = true;
  }

  let languageOrdered = false;
  if (call.lang === "es") {
    const speakers = people.filter((a) => a.speaksSpanish);
    if (speakers.length && speakers.length < people.length) languageOrdered = true;
    people = [...speakers, ...people.filter((a) => !a.speaksSpanish)];
  }

  let preferred: RingOrder["preferred"];
  if (call.preferredAgentId) {
    const p = people.find((a) => a.id === call.preferredAgentId);
    if (!p) preferred = "not_available";
    else if (call.lang === "es" && !p.speaksSpanish) preferred = "language";
    else {
      people = [p, ...people.filter((a) => a.id !== p.id)];
      preferred = "moved";
    }
  }

  return { order: people.map((a) => a.id), strategy, rotate, preferred, languageOrdered };
}
