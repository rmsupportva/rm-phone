/**
 * Forwarding to an agent's own phone — the old phone's rules
 * (rm-telephony dialPlan.ts forward phases, user_phone_prefs forward_*).
 */
import { describe, expect, it } from "vitest";
import { DEMO_SETTINGS } from "./settings";
import { OPEN, agents, harness } from "./testHarness";
import type { AgentForward } from "./types";

const CELL = "+18455550177";
const RING = DEMO_SETTINGS.queue.ringSeconds; // 30

/** A forwards to their cell; B has no forwarding; C is away. */
function ringingWith(forward: AgentForward) {
  const team = agents().map((a) => (a.id === "a" ? { ...a, forward } : a));
  const h = harness(OPEN, team).inbound();
  h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
  return h;
}

describe("forwarding to an agent's own phone", () => {
  it("'ring both': browser and own phone ring together from the start", () => {
    const h = ringingWith({ to: CELL, afterSec: 15, parallel: true });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["a", "b"] });
    expect(h.effects).toContainEqual({ type: "ring_external_for_agent", agentId: "a", to: CELL });
    expect(h.call.pendingForwards).toBeUndefined();
  });

  it("delay 0: only the own phone rings (not the browser)", () => {
    const h = ringingWith({ to: CELL, afterSec: 0, parallel: false });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["b"] });
    expect(h.effects).toContainEqual({ type: "ring_external_for_agent", agentId: "a", to: CELL });
    expect(h.call.ringingAgentIds).toEqual(["a", "b"]); // A can still answer (on the cell)
  });

  it("a delay as long as the ring: only the browser rings", () => {
    const h = ringingWith({ to: CELL, afterSec: RING, parallel: false });
    expect(h.effects.some((e) => e.type === "ring_external_for_agent")).toBe(false);
    h.expire(); // the ring runs out with no forward
    expect(h.call.state).toBe("voicemail");
    expect(h.kinds()).not.toContain("forwarded");
  });

  it("a delay inside the ring: browser first, then the own phone joins, then the ring still ends on time", () => {
    const h = ringingWith({ to: CELL, afterSec: 12, parallel: false });
    const ringStart = h.now;
    expect(h.call.deadline).toEqual({ kind: "ring", at: ringStart + 12_000 });

    h.expire(); // 12 s: the cell joins
    expect(h.effects).toEqual([{ type: "ring_external_for_agent", agentId: "a", to: CELL }]);
    expect(h.call.state).toBe("ringing");
    expect(h.call.deadline).toEqual({ kind: "ring", at: ringStart + RING * 1000 });
    expect(h.kinds()).toContain("forwarded");

    h.expire(); // 30 s: nobody answered
    expect(h.call.state).toBe("voicemail");
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["a", "b"] });
  });

  it("answering on the own phone counts as that agent answering; the forward that was still due is dropped", () => {
    const h = ringingWith({ to: CELL, afterSec: 0, parallel: false });
    h.send({ type: "agent_answered", agentId: "a" });
    expect(h.call.state).toBe("answered");
    expect(h.call.agentId).toBe("a");
    expect(h.call.pendingForwards).toBeUndefined();
  });

  it("someone else answers before the forward is due: it never rings", () => {
    const h = ringingWith({ to: CELL, afterSec: 12, parallel: false });
    h.wait(5).send({ type: "agent_answered", agentId: "b" });
    expect(h.call.pendingForwards).toBeUndefined();
    expect(h.call.deadline?.kind).toBe("max_call");
  });

  it("the forwarding agent declines: their later forward is cancelled too", () => {
    const h = ringingWith({ to: CELL, afterSec: 12, parallel: false });
    h.send({ type: "agent_declined", agentId: "a" });
    expect(h.call.pendingForwards).toBeUndefined();
    expect(h.call.deadline).toEqual({ kind: "ring", at: h.call.ringEndsAt });
  });

  it("an away agent is not rung on their own phone either", () => {
    const team = agents().map((a) => (a.id === "c" ? { ...a, forward: { to: CELL, afterSec: 0, parallel: false } } : a));
    const h = harness(OPEN, team).inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    expect(h.effects.some((e) => e.type === "ring_external_for_agent")).toBe(false);
  });
});
