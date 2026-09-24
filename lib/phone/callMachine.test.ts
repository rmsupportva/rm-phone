import { describe, expect, it } from "vitest";
import { needsCallback } from "./callMachine";
import { AFTER_CANDLES, CLOSED, HOLIDAY, OPEN, agents, harness } from "./testHarness";
import type { Call, CallInput } from "./types";

describe("inbound during office hours", () => {
  it("starts at the language menu", () => {
    const h = harness().inbound();
    expect(h.call.state).toBe("menu");
    expect(h.call.menuStep).toBe("language");
    expect(h.call.hoursState).toBe("open");
    expect(h.call.deadline?.kind).toBe("menu");
  });

  it("rings every available agent at once after pressing 1, 1", () => {
    const h = harness().inbound().send({ type: "caller_pressed", digit: "1" });
    expect(h.call.menuStep).toBe("main");
    h.send({ type: "caller_pressed", digit: "1" });
    expect(h.call.state).toBe("ringing");
    expect(h.call.ringingAgentIds).toEqual(["a", "b"]); // c is away
    expect(h.effects).toContainEqual({ type: "ring", agentIds: ["a", "b"] });
    expect(h.call.deadline?.kind).toBe("ring");
  });

  it("uses Spanish for the rest of the call after pressing 2", () => {
    const h = harness().inbound().send({ type: "caller_pressed", digit: "2" });
    expect(h.call.lang).toBe("es");
    expect(h.effects).toContainEqual({ type: "play", prompt: "main_menu", lang: "es" });
  });

  it("an answer connects one agent and stops everyone else ringing", () => {
    const h = harness().inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    h.wait(5).send({ type: "agent_answered", agentId: "b" });
    expect(h.call.state).toBe("answered");
    expect(h.call.agentId).toBe("b");
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["a"] });
    expect(h.effects).toContainEqual({ type: "connect", agentId: "b" });
    expect(h.team.find((a) => a.id === "b")?.presence).toBe("busy");
  });

  it("goes to voicemail when nobody answers in 30 seconds", () => {
    const h = harness().inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    h.expire();
    expect(h.call.state).toBe("voicemail");
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["a", "b"] });
    expect(h.call.timeline.map((t) => t.kind)).toContain("ring_no_answer");
  });

  it("an answered call NEVER goes to voicemail, even if the ring timer fires late", () => {
    const h = harness().inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    const ringDeadline = h.call.deadline!;
    h.wait(29.9).send({ type: "agent_answered", agentId: "a" });
    h.wait(1).send({ type: "timer", kind: ringDeadline.kind });
    expect(h.call.state).toBe("answered");
    expect(h.effects).toEqual([]);
  });

  it("a second agent answering too late only stops their own ringing", () => {
    const h = harness().inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    h.send({ type: "agent_answered", agentId: "a" });
    h.send({ type: "agent_answered", agentId: "b" });
    expect(h.call.agentId).toBe("a");
    expect(h.effects).toEqual([{ type: "stop_ringing", agentIds: ["b"] }]);
  });

  it("sends the caller to voicemail as soon as the last ringing agent declines", () => {
    const h = harness().inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    h.send({ type: "agent_declined", agentId: "a" });
    expect(h.call.state).toBe("ringing");
    h.send({ type: "agent_declined", agentId: "b" });
    expect(h.call.state).toBe("voicemail");
  });

  it("goes straight to voicemail when nobody is available", () => {
    const team = agents().map((a) => ({ ...a, presence: "away" as const }));
    const h = harness(OPEN, team).inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    expect(h.call.state).toBe("voicemail");
    expect(h.effects).toContainEqual({ type: "play", prompt: "all_busy", lang: "en" });
  });

  it("with no key pressed: English, then the queue", () => {
    const h = harness().inbound().expire();
    expect(h.call.lang).toBe("en");
    expect(h.call.menuStep).toBe("main");
    h.expire();
    expect(h.call.state).toBe("ringing");
  });

  it("ignores wrong keys and keeps waiting", () => {
    const h = harness().inbound().send({ type: "caller_pressed", digit: "7" });
    expect(h.call.state).toBe("menu");
    expect(h.call.menuStep).toBe("language");
  });
});

describe("outside office hours", () => {
  it.each([
    ["evening", CLOSED, "closed"],
    ["holiday", HOLIDAY, "holiday"],
    ["Friday after candle lighting", AFTER_CANDLES, "early_close"],
  ])("%s goes straight to voicemail", (_label, time, prompt) => {
    const h = harness(time).inbound();
    expect(h.call.state).toBe("voicemail");
    expect(h.effects).toContainEqual({ type: "play", prompt, lang: "en" });
    expect(h.effects.some((e) => e.type === "ring")).toBe(false);
  });
});

describe("how an inbound call ends", () => {
  it("hanging up in the menu is a call to return", () => {
    const h = harness().inbound().send({ type: "caller_hung_up" });
    expect(h.call.endReason).toBe("abandoned_menu");
    expect(needsCallback(h.call)).toBe(true);
  });

  it("hanging up during the greeting is a missed call, not an empty voicemail", () => {
    const h = harness(CLOSED).inbound().wait(3).send({ type: "caller_hung_up" });
    expect(h.call.endReason).toBe("missed");
    expect(h.call.voicemail).toBeUndefined();
    expect(needsCallback(h.call)).toBe(true);
  });

  it("a saved message ends the call as voicemail", () => {
    const h = harness(CLOSED).inbound();
    h.send({ type: "voicemail_saved", recording: { id: "r1", seconds: 12 } });
    expect(h.call.endReason).toBe("voicemail");
    expect(h.call.voicemail?.seconds).toBe(12);
  });

  it("a zero-second recording counts as missed", () => {
    const h = harness(CLOSED).inbound();
    h.send({ type: "voicemail_saved", recording: { id: "r1", seconds: 0 } });
    expect(h.call.endReason).toBe("missed");
  });

  it("voicemail that never reports back is closed as missed", () => {
    const h = harness(CLOSED).inbound().expire();
    expect(h.call.state).toBe("ended");
    expect(h.call.endReason).toBe("missed");
  });

  it("after a conversation: completed, talk time counted, agent in wrap-up", () => {
    const h = harness().inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    h.send({ type: "agent_answered", agentId: "a" }).wait(65);
    h.send({ type: "agent_hung_up", agentId: "a" });
    expect(h.call.endReason).toBe("completed");
    expect(h.call.talkSeconds).toBe(65);
    expect(h.effects).toContainEqual({ type: "hang_up_caller" });
    expect(h.team.find((a) => a.id === "a")?.presence).toBe("wrap_up");
    expect(needsCallback(h.call)).toBe(false);
  });

  it("a different agent cannot hang up someone else's call", () => {
    const h = harness().inbound();
    h.send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    h.send({ type: "agent_answered", agentId: "a" });
    h.send({ type: "agent_hung_up", agentId: "b" });
    expect(h.call.state).toBe("answered");
  });
});

describe("outbound", () => {
  it("dials and marks the agent busy", () => {
    const h = harness().outbound();
    expect(h.call.state).toBe("dialing");
    expect(h.effects).toContainEqual({ type: "dial", to: "+18455550122" });
    expect(h.team.find((a) => a.id === "a")?.presence).toBe("busy");
  });

  it("answered, then the other side hangs up", () => {
    const h = harness().outbound().wait(4).send({ type: "far_end_answered" });
    expect(h.call.state).toBe("answered");
    h.wait(30).send({ type: "caller_hung_up" });
    expect(h.call.endReason).toBe("completed");
    expect(h.call.talkSeconds).toBe(30);
    expect(h.effects).toContainEqual({ type: "hang_up_agent", agentId: "a" });
  });

  it("nobody picks up: no answer, agent back to available", () => {
    const h = harness().outbound().expire();
    expect(h.call.endReason).toBe("no_answer");
    expect(h.team.find((a) => a.id === "a")?.presence).toBe("available");
  });

  it("the agent cancels before an answer", () => {
    const h = harness().outbound().send({ type: "agent_hung_up", agentId: "a" });
    expect(h.call.endReason).toBe("cancelled");
  });
});

describe("safety rules hold for ANY sequence of events", () => {
  const INPUTS: CallInput[] = [
    { type: "caller_pressed", digit: "1" },
    { type: "caller_pressed", digit: "2" },
    { type: "caller_pressed", digit: "9" },
    { type: "agent_answered", agentId: "a" },
    { type: "agent_answered", agentId: "b" },
    { type: "agent_declined", agentId: "a" },
    { type: "agent_unavailable", agentId: "b" },
    { type: "caller_hung_up" },
    { type: "agent_hung_up", agentId: "a" },
    { type: "agent_hung_up", agentId: "b" },
    { type: "voicemail_saved", recording: { id: "r", seconds: 5 } },
    { type: "far_end_answered" },
    { type: "far_end_failed" },
    // During a call:
    { type: "agent_answered", agentId: "c" },
    { type: "agent_declined", agentId: "c" },
    { type: "agent_hung_up", agentId: "c" },
    { type: "hold", agentId: "a" },
    { type: "resume", agentId: "a" },
    { type: "park", agentId: "a" },
    { type: "park", agentId: "b" },
    { type: "unpark", agentId: "b" },
    { type: "unpark", agentId: "c" },
    { type: "transfer", agentId: "a", mode: "warm", target: { kind: "agent", agentId: "c" } },
    { type: "transfer", agentId: "b", mode: "blind", target: { kind: "queue" } },
    { type: "transfer", agentId: "a", mode: "warm", target: { kind: "external", to: "+18455550199" } },
    { type: "transfer", agentId: "a", mode: "blind", target: { kind: "external", to: "+18455550199" } },
    { type: "transfer", agentId: "b", mode: "blind", target: { kind: "external", to: "+18455550199" } },
    { type: "external_answered" },
    { type: "transfer_complete", agentId: "a" },
    { type: "transfer_cancel", agentId: "b" },
    { type: "external_answered" },
    { type: "external_failed" },
    { type: "external_hung_up" },
    { type: "invite", agentId: "a", targets: ["c", "b"] },
    { type: "invite", agentId: "b", targets: ["c", "a"] },
    { type: "invite_cancel", agentId: "a" },
    { type: "participant_left", agentId: "c" },
  ];

  // A small deterministic random generator, so a failure can be replayed.
  function rng(seed: number) {
    return () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
  }

  it("never breaks the rules across 3,000 random calls", () => {
    // Prove the random walk really reaches the tricky situations.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 3000; seed++) {
      const rand = rng(seed);
      const starts = [OPEN, CLOSED, HOLIDAY, AFTER_CANDLES];
      // C is sometimes available, so transfers and adding a VA have someone to ring.
      const fwdRoll = rand();
      const team = agents().map((a) => {
        if (a.id === "c" && rand() < 0.6) return { ...a, presence: "available" as const };
        // B sometimes forwards to their own phone: at once, after a delay, or in parallel.
        if (a.id === "b" && fwdRoll < 0.5) {
          return { ...a, forward: { to: "+18455550177", afterSec: fwdRoll < 0.15 ? 0 : 10, parallel: fwdRoll > 0.35 } };
        }
        return a;
      });
      const h = harness(starts[Math.floor(rand() * starts.length)], team);
      if (rand() < 0.75) h.inbound();
      else h.outbound();
      let everAnswered = false;

      for (let i = 0; i < 24; i++) {
        if (rand() < 0.3 && h.call.deadline) h.expire();
        else h.wait(rand() * 40).send(rand() < 0.35 ? pick(INPUTS, rand) : sensibleInput(h.call, rand));

        const c = h.call;
        if (c.answeredAt !== undefined) everAnswered = true;
        seen.add(c.state);
        if (c.onHold) seen.add("on hold");
        if (c.transfer) seen.add(`transfer ${c.transfer.phase}`);
        if (c.participants) seen.add("three-way");
        if (c.state === "ended") seen.add(`ended ${c.endReason}`);
        if (c.state === "ringing" && c.answeredAt !== undefined) seen.add("re-ringing a held caller");
        if (c.timeline.some((t) => t.kind === "forwarded")) seen.add("forwarded to own phone");
        const broken = brokenRule(c, everAnswered);
        if (broken) expect.fail(`seed ${seed}, step ${i}, state ${c.state}: ${broken}`);      }
    }
    for (const situation of [
      "parked",
      "on hold",
      "transfer ringing",
      "transfer consulting",
      "three-way",
      "re-ringing a held caller",
      "forwarded to own phone",
      "ended transferred",
      "ended voicemail",
      "ended timed_out",
    ]) {
      expect(seen, `never reached: ${situation}`).toContain(situation);
    }
  });
});

/**
 * The safety rules, checked with plain code (hundreds of thousands of checks;
 * calling expect() for each is too slow). Returns the broken rule, or null.
 */
function brokenRule(c: Call, everAnswered: boolean): string | null {
  // 1. Every open call has a deadline; an ended call has none.
  if (c.state === "ended") {
    if (c.deadline) return "an ended call still has a deadline";
    if (c.endedAt === undefined) return "an ended call has no end time";
    if (c.ringingAgentIds.length) return "an ended call is still ringing someone";
  } else if (!c.deadline) {
    return "an open call has no deadline";
  }
  // 2. Once answered, never voicemail, never missed. (It may ring the team
  //    again, e.g. after parking, but that ends parked, not voicemail.)
  if (everAnswered) {
    if (c.state === "voicemail") return "an answered caller was sent to voicemail";
    if (c.state === "ended" && !["completed", "timed_out", "transferred"].includes(c.endReason ?? "")) {
      return `an answered call ended as ${c.endReason}`;
    }
  }
  // 3. Only an answered call has an answering agent on an inbound call.
  if (c.direction === "inbound" && c.state !== "answered" && !everAnswered && c.agentId) {
    return "an unanswered inbound call has an agent";
  }
  // 4. An ended call leaves nothing behind.
  if (c.state === "ended" && (c.transfer || c.inviting || c.participants || c.onHold !== undefined)) {
    return "an ended call left a transfer, invite, extra person or hold behind";
  }
  // 6. Own-phone forwards only wait while the call is ringing.
  if (c.state !== "ringing" && (c.pendingForwards || c.ringEndsAt !== undefined)) return "forwarding left over after the ring";
  // 5. A parked caller is on hold with no agent; transfers and invites only exist mid-call.
  if (c.state === "parked" && (c.onHold !== true || c.agentId)) return "a parked caller is not properly on hold";
  if ((c.transfer || c.inviting) && c.state !== "answered") return "a transfer or invite outside a live call";
  return null;
}

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}

/**
 * An input that makes sense for the call's current state, from the people
 * actually involved, so the random walk reaches deep situations (a warm
 * transfer being completed, a VA joining) instead of mostly bouncing off.
 */
function sensibleInput(c: Call, rand: () => number): CallInput {
  const anyone = pick(["a", "b", "c"], rand);
  const agent = c.agentId ?? anyone;
  const other = pick(["a", "b", "c"].filter((x) => x !== agent), rand);
  const mode = rand() < 0.5 ? "warm" : "blind";
  switch (c.state) {
    case "menu":
      return pick<CallInput>([{ type: "caller_pressed", digit: "1" }, { type: "caller_pressed", digit: "2" }, { type: "caller_hung_up" }], rand);
    case "ringing":
      return pick<CallInput>(
        [
          { type: "agent_answered", agentId: pick(c.ringingAgentIds.length ? c.ringingAgentIds : [anyone], rand) },
          { type: "agent_declined", agentId: pick(c.ringingAgentIds.length ? c.ringingAgentIds : [anyone], rand) },
          { type: "caller_hung_up" },
        ],
        rand,
      );
    case "parked":
      return pick<CallInput>([{ type: "unpark", agentId: anyone }, { type: "caller_hung_up" }], rand);
    case "dialing":
      return pick<CallInput>([{ type: "far_end_answered" }, { type: "far_end_failed" }, { type: "agent_hung_up", agentId: agent }], rand);
    case "answered": {
      const t = c.transfer;
      if (t?.phase === "ringing") {
        const target = t.ringingAgentIds.length ? pick(t.ringingAgentIds, rand) : anyone;
        return pick<CallInput>(
          [
            { type: "agent_answered", agentId: target },
            { type: "agent_declined", agentId: target },
            { type: "external_answered" },
            { type: "external_failed" },
            { type: "transfer_cancel", agentId: t.byAgentId ?? anyone },
            { type: "agent_hung_up", agentId: t.byAgentId ?? anyone },
          ],
          rand,
        );
      }
      if (t?.phase === "consulting") {
        return pick<CallInput>(
          [
            { type: "transfer_complete", agentId: t.byAgentId ?? anyone },
            { type: "transfer_cancel", agentId: t.byAgentId ?? anyone },
            { type: "agent_hung_up", agentId: t.answeredBy ?? anyone },
            { type: "external_hung_up" },
          ],
          rand,
        );
      }
      if (c.inviting) {
        const va = c.inviting.ringingAgentIds.length ? pick(c.inviting.ringingAgentIds, rand) : anyone;
        return pick<CallInput>([{ type: "agent_answered", agentId: va }, { type: "agent_declined", agentId: va }, { type: "invite_cancel", agentId: agent }], rand);
      }
      return pick<CallInput>(
        [
          { type: "hold", agentId: agent },
          { type: "resume", agentId: agent },
          { type: "park", agentId: agent },
          { type: "transfer", agentId: agent, mode, target: { kind: "agent", agentId: other } },
          { type: "transfer", agentId: agent, mode, target: { kind: "queue" } },
          { type: "transfer", agentId: agent, mode, target: { kind: "external", to: "+18455550199" } },
          { type: "invite", agentId: agent, targets: [other] },
          { type: "invite", agentId: agent, targets: [other], thenTargets: ["a", "b", "c"] },
          { type: "participant_left", agentId: pick(c.participants ?? [other], rand) },
          { type: "caller_hung_up" },
          { type: "agent_hung_up", agentId: agent },
        ],
        rand,
      );
    }
    default:
      return { type: "caller_hung_up" };
  }
}