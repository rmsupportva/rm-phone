import { describe, expect, it } from "vitest";
import { OPEN, agents, harness } from "./testHarness";

/** A, B and C all available; A answers the call. */
const team = () => agents().map((a) => ({ ...a, presence: "available" as const }));
const onCallWithA = () => harness(OPEN, team()).answeredBy("a");

describe("hold", () => {
  it("puts the caller on hold and back", () => {
    const h = onCallWithA().send({ type: "hold", agentId: "a" });
    expect(h.call.onHold).toBe(true);
    expect(h.effects).toEqual([{ type: "hold_caller" }]);
    h.send({ type: "resume", agentId: "a" });
    expect(h.call.onHold).toBe(false);
    expect(h.effects).toEqual([{ type: "unhold_caller" }]);
  });

  it("only the agent on the call can hold it", () => {
    const h = onCallWithA().send({ type: "hold", agentId: "b" });
    expect(h.call.onHold).toBeUndefined();
    expect(h.effects).toEqual([]);
  });
});

describe("park", () => {
  it("parks: caller on hold, agent freed for other calls", () => {
    const h = onCallWithA().send({ type: "park", agentId: "a" });
    expect(h.call.state).toBe("parked");
    expect(h.call.parkedBy).toBe("a");
    expect(h.call.agentId).toBeUndefined();
    expect(h.effects).toContainEqual({ type: "hold_caller" });
    expect(h.effects).toContainEqual({ type: "remove_from_call", agentId: "a" });
    expect(h.presence("a")).toBe("available");
    expect(h.call.deadline?.kind).toBe("park");
  });

  it("anyone available can pick up a parked call; talk time keeps counting", () => {
    const h = onCallWithA().wait(30).send({ type: "park", agentId: "a" });
    const answeredAt = h.call.answeredAt;
    h.wait(20).send({ type: "unpark", agentId: "b" });
    expect(h.call.state).toBe("answered");
    expect(h.call.agentId).toBe("b");
    expect(h.call.answeredAt).toBe(answeredAt);
    expect(h.effects).toContainEqual({ type: "unhold_caller" });
    expect(h.effects).toContainEqual({ type: "connect", agentId: "b" });
    expect(h.presence("b")).toBe("busy");
  });

  it("a forgotten parked call rings the whole team, and is never sent to voicemail", () => {
    const h = onCallWithA().send({ type: "park", agentId: "a" }).expire();
    expect(h.kinds()).toContain("park_timeout");
    expect(h.call.state).toBe("ringing");
    expect(h.call.ringingAgentIds.sort()).toEqual(["a", "b", "c"]);
    h.expire(); // nobody answers
    expect(h.call.state).toBe("parked");
    expect(h.call.deadline?.kind).toBe("park");
  });

  it("the team member who answers the re-ring takes the caller off hold", () => {
    const h = onCallWithA().send({ type: "park", agentId: "a" }).expire();
    h.send({ type: "agent_answered", agentId: "c" });
    expect(h.call.state).toBe("answered");
    expect(h.call.agentId).toBe("c");
    expect(h.effects).toContainEqual({ type: "unhold_caller" });
    expect(h.kinds()).toContain("picked_up");
  });

  it("a caller who hangs up while parked is a completed call, not a missed one", () => {
    const h = onCallWithA().send({ type: "park", agentId: "a" }).send({ type: "caller_hung_up" });
    expect(h.call.endReason).toBe("completed");
  });
});

describe("warm transfer to a teammate", () => {
  const start = () =>
    onCallWithA().send({ type: "transfer", agentId: "a", mode: "warm", target: { kind: "agent", agentId: "b" } });

  it("holds the caller and rings the teammate; the agent stays on", () => {
    const h = start();
    expect(h.call.onHold).toBe(true);
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["b"] });
    expect(h.call.agentId).toBe("a");
    expect(h.call.deadline?.kind).toBe("transfer");
  });

  it("the teammate answers: the two talk first, then Complete hands the caller over", () => {
    const h = start().send({ type: "agent_answered", agentId: "b" });
    expect(h.call.transfer?.phase).toBe("consulting");
    expect(h.call.onHold).toBe(true);
    expect(h.effects).toContainEqual({ type: "add_to_call", agentId: "b" });
    h.send({ type: "transfer_complete", agentId: "a" });
    expect(h.call.agentId).toBe("b");
    expect(h.call.transfer).toBeUndefined();
    expect(h.call.onHold).toBe(false);
    expect(h.effects).toContainEqual({ type: "remove_from_call", agentId: "a" });
    expect(h.presence("a")).toBe("wrap_up");
    expect(h.presence("b")).toBe("busy");
  });

  it("hanging up after talking to the teammate completes the transfer", () => {
    const h = start().send({ type: "agent_answered", agentId: "b" }).send({ type: "agent_hung_up", agentId: "a" });
    expect(h.call.state).toBe("answered");
    expect(h.call.agentId).toBe("b");
  });

  it("no answer: the transfer is called off and the agent still has the caller", () => {
    const h = start().expire();
    expect(h.kinds()).toContain("transfer_failed");
    expect(h.call.agentId).toBe("a");
    expect(h.call.onHold).toBe(false);
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["b"] });
    expect(h.call.deadline?.kind).toBe("max_call");
  });

  it("the teammate declines: straight back to the agent", () => {
    const h = start().send({ type: "agent_declined", agentId: "b" });
    expect(h.call.transfer).toBeUndefined();
    expect(h.call.onHold).toBe(false);
  });

  it("the teammate hangs up during the chat: back to the agent, caller off hold", () => {
    const h = start().send({ type: "agent_answered", agentId: "b" }).send({ type: "agent_hung_up", agentId: "b" });
    expect(h.call.agentId).toBe("a");
    expect(h.call.transfer).toBeUndefined();
    expect(h.presence("b")).toBe("available");
  });

  it("cancel during the chat drops the teammate and resumes the caller", () => {
    const h = start().send({ type: "agent_answered", agentId: "b" }).send({ type: "transfer_cancel", agentId: "a" });
    expect(h.effects).toContainEqual({ type: "remove_from_call", agentId: "b" });
    expect(h.effects).toContainEqual({ type: "unhold_caller" });
    expect(h.call.agentId).toBe("a");
  });

  it("refuses to transfer to someone who isn't available, and says why", () => {
    const h = harness(OPEN).answeredBy("a"); // C is away in the default team
    h.send({ type: "transfer", agentId: "a", mode: "warm", target: { kind: "agent", agentId: "c" } });
    expect(h.call.transfer).toBeUndefined();
    expect(h.kinds()).toContain("transfer_failed");
    expect(h.call.onHold).toBeUndefined();
  });
});

describe("blind transfer", () => {
  it("to the line: everyone else rings; the first to answer gets the caller directly", () => {
    const h = onCallWithA().send({ type: "transfer", agentId: "a", mode: "blind", target: { kind: "queue" } });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["b", "c"] });
    h.send({ type: "agent_answered", agentId: "c" });
    expect(h.call.agentId).toBe("c");
    expect(h.call.transfer).toBeUndefined();
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["b"] });
    expect(h.presence("a")).toBe("wrap_up");
  });

  it("the agent hangs up while the target rings: the transfer carries on without them", () => {
    const h = onCallWithA().send({ type: "transfer", agentId: "a", mode: "warm", target: { kind: "agent", agentId: "b" } });
    h.send({ type: "agent_hung_up", agentId: "a" });
    expect(h.call.state).toBe("answered");
    expect(h.call.agentId).toBeUndefined();
    expect(h.presence("a")).toBe("wrap_up");
    h.send({ type: "agent_answered", agentId: "b" });
    expect(h.call.agentId).toBe("b");
  });

  it("…and if the target never answers, the team is rung instead of dropping the caller", () => {
    const h = onCallWithA().send({ type: "transfer", agentId: "a", mode: "blind", target: { kind: "agent", agentId: "b" } });
    h.send({ type: "agent_hung_up", agentId: "a" }).expire();
    expect(h.kinds()).toContain("transfer_failed");
    expect(h.call.state).toBe("ringing");
  });
});

describe("transfer to an outside number", () => {
  const start = (mode: "warm" | "blind") =>
    onCallWithA().send({ type: "transfer", agentId: "a", mode, target: { kind: "external", to: "+18455550199" } });

  it("blind: we step out when they answer and the call ends as transferred", () => {
    const h = start("blind");
    expect(h.effects).toContainEqual({ type: "dial_external", to: "+18455550199" });
    h.send({ type: "external_answered" });
    expect(h.effects).toContainEqual({ type: "release_to_external" });
    expect(h.call.endReason).toBe("transferred");
    expect(h.presence("a")).toBe("wrap_up");
  });

  it("warm: talk first, then complete", () => {
    const h = start("warm").send({ type: "external_answered" });
    expect(h.call.transfer?.phase).toBe("consulting");
    h.send({ type: "transfer_complete", agentId: "a" });
    expect(h.call.endReason).toBe("transferred");
  });

  it("an unreachable number comes back to the agent", () => {
    const h = start("warm").send({ type: "external_failed" });
    expect(h.call.transfer).toBeUndefined();
    expect(h.call.agentId).toBe("a");
  });

  it("the caller hanging up mid-transfer also hangs up the outside number", () => {
    const h = start("warm").send({ type: "caller_hung_up" });
    expect(h.effects).toContainEqual({ type: "hang_up_external" });
    expect(h.call.endReason).toBe("completed");
  });
});

describe("adding someone to the call (Call VA)", () => {
  it("rings the VAs; the first to answer joins, the rest stop", () => {
    const h = onCallWithA().send({ type: "invite", agentId: "a", targets: ["c", "b"] });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["c", "b"] });
    expect(h.call.deadline?.kind).toBe("invite");
    h.send({ type: "agent_answered", agentId: "c" });
    expect(h.call.participants).toEqual(["c"]);
    expect(h.effects).toContainEqual({ type: "add_to_call", agentId: "c" });
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["b"] });
    expect(h.call.agentId).toBe("a"); // still A's call
    expect(h.call.deadline?.kind).toBe("max_call");
  });

  it("nobody answers: nothing changes for the caller", () => {
    const h = onCallWithA().send({ type: "invite", agentId: "a", targets: ["c"] }).expire();
    expect(h.call.inviting).toBeUndefined();
    expect(h.call.state).toBe("answered");
    expect(h.kinds()).toContain("invite_no_answer");
  });

  it("the VA can leave; the call carries on", () => {
    const h = onCallWithA().send({ type: "invite", agentId: "a", targets: ["c"] }).send({ type: "agent_answered", agentId: "c" });
    h.send({ type: "agent_hung_up", agentId: "c" });
    expect(h.call.participants).toBeUndefined();
    expect(h.call.state).toBe("answered");
    expect(h.presence("c")).toBe("wrap_up");
  });

  it("when the call ends, the VA is hung up and gets wrap-up too", () => {
    const h = onCallWithA().send({ type: "invite", agentId: "a", targets: ["c"] }).send({ type: "agent_answered", agentId: "c" });
    h.send({ type: "caller_hung_up" });
    expect(h.effects).toContainEqual({ type: "hang_up_agent", agentId: "c" });
    expect(h.presence("c")).toBe("wrap_up");
    expect(h.presence("a")).toBe("wrap_up");
  });

  it("skips people who aren't available or are already on the call", () => {
    const h = harness(OPEN).answeredBy("a").send({ type: "invite", agentId: "a", targets: ["a", "c"] });
    expect(h.call.inviting).toBeUndefined(); // A is on it already, C is away
    expect(h.kinds()).toContain("invite_failed");
  });
});

describe("Call VA in two rounds (the old phone's cascade)", () => {
  /** A on the call; B is A's own VA; C (and D) are the VA pool. */
  const withPool = () => {
    const team = [
      ...agents().map((a) => ({ ...a, presence: "available" as const })),
      { id: "d", name: "D", presence: "available" as const, speaksSpanish: true, queueIds: ["screening"] },
    ];
    return harness(OPEN, team).answeredBy("a");
  };

  it("rings my own VA first, for 8 seconds", () => {
    const h = withPool().send({ type: "invite", agentId: "a", targets: ["b"], thenTargets: ["b", "c", "d"] });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["b"] });
    expect(h.call.deadline).toEqual({ kind: "invite", at: h.now + 8_000 });
  });

  it("my VA doesn't answer: every VA rings at once for 18 seconds (my VA included again)", () => {
    const h = withPool().send({ type: "invite", agentId: "a", targets: ["b"], thenTargets: ["b", "c", "d"] }).expire();
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["b"] });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["b", "c", "d"] });
    expect(h.call.deadline).toEqual({ kind: "invite", at: h.now + 18_000 });
    h.send({ type: "agent_answered", agentId: "d" });
    expect(h.call.participants).toEqual(["d"]);
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["b", "c"] });
  });

  it("my VA declines: the pool rings straight away", () => {
    const h = withPool().send({ type: "invite", agentId: "a", targets: ["b"], thenTargets: ["c", "d"] });
    h.send({ type: "agent_declined", agentId: "b" });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["c", "d"] });
  });

  it("nobody in either round: nothing changes for the caller", () => {
    const h = withPool().send({ type: "invite", agentId: "a", targets: ["b"], thenTargets: ["c"] }).expire().expire();
    expect(h.call.inviting).toBeUndefined();
    expect(h.call.state).toBe("answered");
    expect(h.kinds()).toContain("invite_no_answer");
    expect(h.call.deadline?.kind).toBe("max_call");
  });

  it("no own VA (or they're away): the pool rings at once", () => {
    const h = withPool().send({ type: "invite", agentId: "a", targets: [], thenTargets: ["c", "d"] });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["c", "d"] });
    expect(h.call.deadline).toEqual({ kind: "invite", at: h.now + 18_000 });
  });

  it("a VA in wrap-up can still be asked to join (old pool rule), an away one can't", () => {
    const team = agents().map((a) =>
      a.id === "b" ? { ...a, presence: "wrap_up" as const } : a.id === "c" ? { ...a, presence: "away" as const } : a,
    );
    const h = harness(OPEN, team).answeredBy("a").send({ type: "invite", agentId: "a", targets: [], thenTargets: ["b", "c"] });
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["b"] });
  });
});