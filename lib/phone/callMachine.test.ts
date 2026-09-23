import { describe, expect, it } from "vitest";
import { needsCallback, startInbound, startOutbound, step, type MachineContext } from "./callMachine";
import { DEMO_SETTINGS } from "./settings";
import type { Agent, Call, CallInput, Effect } from "./types";

const OPEN = Date.parse("2026-09-22T11:00:00-04:00"); // Tuesday 11:00
const CLOSED = Date.parse("2026-09-22T19:00:00-04:00");
const HOLIDAY = Date.parse("2026-09-28T11:00:00-04:00");
const AFTER_CANDLES = Date.parse("2026-12-11T16:30:00-05:00");

const agents = (): Agent[] => [
  { id: "a", name: "A", presence: "available", speaksSpanish: false, queueIds: ["screening"] },
  { id: "b", name: "B", presence: "available", speaksSpanish: true, queueIds: ["screening"] },
  { id: "c", name: "C", presence: "away", speaksSpanish: false, queueIds: ["screening"] },
];

/** A tiny harness: feed inputs, track time and the agents' presence. */
function harness(start = OPEN, team = agents()) {
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
    team,
    inbound() {
      const r = startInbound("call-1", "+18455550111", ctx());
      h.call = r.call;
      effects = r.effects;
      applyPresence(effects);
      return h;
    },
    outbound(agentId = "a") {
      const r = startOutbound("call-1", agentId, "+18455550122", ctx());
      h.call = r.call;
      effects = r.effects;
      applyPresence(effects);
      return h;
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
      now = d.at;
      return h.send({ type: "timer", kind: d.kind });
    },
  };
  return h;
}

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
  ];

  // A small deterministic random generator, so a failure can be replayed.
  function rng(seed: number) {
    return () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
  }

  it("never breaks the rules across 3,000 random calls", () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const rand = rng(seed);
      const starts = [OPEN, CLOSED, HOLIDAY, AFTER_CANDLES];
      const h = harness(starts[Math.floor(rand() * starts.length)]);
      if (rand() < 0.75) h.inbound();
      else h.outbound();
      let everAnswered = false;

      for (let i = 0; i < 12; i++) {
        if (rand() < 0.3 && h.call.deadline) h.expire();
        else h.wait(rand() * 40).send(INPUTS[Math.floor(rand() * INPUTS.length)]);

        const c = h.call;
        if (c.answeredAt !== undefined) everAnswered = true;
        const where = `seed ${seed}, step ${i}, state ${c.state}`;

        // 1. Every open call has a deadline; an ended call has none.
        if (c.state === "ended") {
          expect(c.deadline, where).toBeUndefined();
          expect(c.endedAt, where).toBeDefined();
          expect(c.ringingAgentIds, where).toEqual([]);
        } else {
          expect(c.deadline, where).toBeDefined();
        }
        // 2. Once answered, never voicemail, never missed.
        if (everAnswered) {
          expect(c.state === "voicemail" || c.state === "ringing", where).toBe(false);
          if (c.state === "ended") {
            expect(["completed", "timed_out"], where).toContain(c.endReason);
          }
        }
        // 3. Only an answered call has an answering agent on an inbound call.
        if (c.direction === "inbound" && c.state !== "answered" && !everAnswered) {
          expect(c.agentId, where).toBeUndefined();
        }
      }
    }
  });
});
