/**
 * Test helper: drive one call through the call brain by hand — feed inputs,
 * move time, and keep the team's presence in step with the effects, the way
 * the engine does. Used by the *.test.ts files only.
 */
import { startInbound, startOutbound, step, type MachineContext } from "./callMachine";
import { DEMO_SETTINGS } from "./settings";
import type { Agent, Call, CallInput, Effect } from "./types";

export const OPEN = Date.parse("2026-09-22T11:00:00-04:00"); // Tuesday 11:00
export const CLOSED = Date.parse("2026-09-22T19:00:00-04:00");
export const HOLIDAY = Date.parse("2026-09-28T11:00:00-04:00");
export const AFTER_CANDLES = Date.parse("2026-12-11T16:30:00-05:00");

export const agents = (): Agent[] => [
  { id: "a", name: "A", presence: "available", speaksSpanish: false, queueIds: ["screening"] },
  { id: "b", name: "B", presence: "available", speaksSpanish: true, queueIds: ["screening"] },
  { id: "c", name: "C", presence: "away", speaksSpanish: false, queueIds: ["screening"] },
];

export function harness(start = OPEN, team = agents()) {
  let now = start;
  let effects: Effect[] = [];
  const ctx = (): MachineContext => ({ now, settings: DEMO_SETTINGS, agents: team });
  const applyPresence = (fx: Effect[]) => {
    for (const e of fx) {
      if (e.type === "set_presence") {
        const a = team.find((x) => x.id === e.agentId);
        if (a) a.presence = e.presence;
      }
    }
  };
  const h = {
    call: undefined as unknown as Call,
    get effects() {
      return effects;
    },
    get now() {
      return now;
    },
    team,
    presence: (id: string) => team.find((a) => a.id === id)?.presence,
    inbound() {
      const r = startInbound("call-1", "+18455550111", ctx());
      h.call = r.call;
      effects = r.effects;
      applyPresence(effects);
      return h;
    },
    outbound(agentId = "a", opts: { agentCell?: string } = {}) {
      const r = startOutbound("call-1", agentId, "+18455550122", ctx(), opts);
      h.call = r.call;
      effects = r.effects;
      applyPresence(effects);
      return h;
    },
    /** Inbound, through the menu, answered by `agentId`. */
    answeredBy(agentId = "a") {
      h.inbound();
      h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
      return h.send({ type: "agent_answered", agentId });
    },
    send(input: CallInput) {
      const r = step(h.call, input, ctx());
      h.call = r.call;
      effects = r.effects;
      applyPresence(effects);
      return h;
    },
    wait(seconds: number) {
      now += seconds * 1000;
      return h;
    },
    /** Let the deadline pass and fire its timer, like the engine's tick. */
    expire() {
      const d = h.call.deadline;
      if (!d) throw new Error("no deadline");
      now = Math.max(now, d.at);
      return h.send({ type: "timer", kind: d.kind });
    },
    kinds: () => h.call.timeline.map((t) => t.kind),
  };
  return h;
}
