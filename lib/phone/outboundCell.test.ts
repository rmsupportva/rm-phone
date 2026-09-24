/**
 * Calling out from the agent's own phone (old phone: outbound_via = cell, the
 * 2026-09-24 fix): ring the agent first; dial the other side only once the
 * agent's phone answers; never ring both at once.
 */
import { describe, expect, it } from "vitest";
import { OPEN, harness } from "./testHarness";

const MY_CELL = "+18455550155";
const FAMILY = "+18455550122";
const fromMyCell = () => harness(OPEN).outbound("a", { agentCell: MY_CELL });

describe("calling out from my own cell", () => {
  it("rings MY phone first; the family is not dialled yet", () => {
    const h = fromMyCell();
    expect(h.effects).toContainEqual({ type: "dial_agent_cell", agentId: "a", to: MY_CELL });
    expect(h.effects.some((e) => e.type === "dial")).toBe(false);
    expect(h.call.dialPhase).toBe("agent");
    expect(h.presence("a")).toBe("busy");
  });

  it("the moment my phone answers, the family is dialled", () => {
    const h = fromMyCell().wait(6).send({ type: "agent_answered", agentId: "a" });
    expect(h.effects).toEqual([{ type: "dial", to: FAMILY }]);
    expect(h.call.dialPhase).toBe("family");
    expect(h.call.state).toBe("dialing");
    h.wait(5).send({ type: "far_end_answered" });
    expect(h.call.state).toBe("answered");
  });

  it("my phone never answers: the family is never called, and the call ends as cancelled", () => {
    const h = fromMyCell().expire();
    expect(h.call.endReason).toBe("cancelled");
    expect(h.effects).toContainEqual({ type: "hang_up_agent", agentId: "a" });
    expect(h.effects.some((e) => e.type === "dial" || e.type === "hang_up_caller")).toBe(false);
    expect(h.presence("a")).toBe("available");
  });

  it("I decline on my phone: nobody else is called", () => {
    const h = fromMyCell().send({ type: "agent_declined", agentId: "a" });
    expect(h.call.endReason).toBe("cancelled");
    expect(h.effects.some((e) => e.type === "dial")).toBe(false);
  });

  it("I hang up while my phone still rings: nothing to hang up on the family side", () => {
    const h = fromMyCell().send({ type: "agent_hung_up", agentId: "a" });
    expect(h.call.endReason).toBe("cancelled");
    expect(h.effects.some((e) => e.type === "hang_up_caller")).toBe(false);
  });

  it("the family can't 'answer' or 'fail' before being dialled", () => {
    const h = fromMyCell().send({ type: "far_end_answered" });
    expect(h.call.state).toBe("dialing");
    h.send({ type: "far_end_failed" });
    expect(h.call.state).toBe("dialing");
  });

  it("someone else's answer doesn't start the family leg", () => {
    const h = fromMyCell().send({ type: "agent_answered", agentId: "b" });
    expect(h.call.dialPhase).toBe("agent");
    expect(h.effects).toEqual([]);
  });

  it("after my phone answered, the family not answering ends as no answer", () => {
    const h = fromMyCell().send({ type: "agent_answered", agentId: "a" }).expire();
    expect(h.call.endReason).toBe("no_answer");
    expect(h.effects).toContainEqual({ type: "hang_up_caller" });
  });

  it("a normal browser call still dials straight away", () => {
    const h = harness(OPEN).outbound("a");
    expect(h.effects).toContainEqual({ type: "dial", to: FAMILY });
    expect(h.call.dialPhase).toBeUndefined();
  });
});
