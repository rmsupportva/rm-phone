/**
 * Ring order and overflow — the old phone's queue rules (strategies,
 * priority, round robin, longest idle, Spanish first, preferred agent,
 * overflow to voicemail / goodbye / one other queue).
 */
import { describe, expect, it } from "vitest";
import { DEMO_SETTINGS, type PhoneSettings, type QueueSettings } from "./settings";
import { OPEN, harness } from "./testHarness";
import type { Agent } from "./types";

const RING = 20;
const team = (): Agent[] => [
  { id: "a", name: "A", presence: "available", speaksSpanish: false, queueIds: ["main"], priority: 2, idleSince: 3_000 },
  { id: "b", name: "B", presence: "available", speaksSpanish: true, queueIds: ["main"], priority: 1, idleSince: 1_000 },
  { id: "c", name: "C", presence: "available", speaksSpanish: false, queueIds: ["main", "backup"], priority: 3, idleSince: 2_000 },
  { id: "d", name: "D", presence: "available", speaksSpanish: true, queueIds: ["backup"] },
];
const settingsWith = (queue: Partial<QueueSettings>, otherQueues: QueueSettings[] = []): PhoneSettings => ({
  ...DEMO_SETTINGS,
  queue: { id: "main", name: "Main", ringSeconds: RING, ...queue },
  otherQueues,
});
/** Through the menu (1 = English, 2 = Spanish) into the queue. */
const call = (settings: PhoneSettings, langKey = "1", t = team(), opts: { preferredAgentId?: string } = {}) =>
  harness(OPEN, t, settings).inbound(opts).send({ type: "caller_pressed", digit: langKey }).send({ type: "caller_pressed", digit: "1" });
const ringingNow = (h: ReturnType<typeof harness>) => h.call.ringingAgentIds;

describe("one at a time (linear)", () => {
  const s = settingsWith({ strategy: "linear" });

  it("rings in priority order, each for the full ring time", () => {
    const h = call(s);
    expect(ringingNow(h)).toEqual(["b"]);
    expect(h.call.deadline).toEqual({ kind: "ring", at: h.now + RING * 1000 });
    h.expire();
    expect(ringingNow(h)).toEqual(["a"]);
    expect(h.effects).toContainEqual({ type: "stop_ringing", agentIds: ["b"] });
    h.expire();
    expect(ringingNow(h)).toEqual(["c"]);
    h.expire();
    expect(h.call.state).toBe("voicemail"); // then the overflow (voicemail by default)
  });

  it("a decline moves straight to the next person", () => {
    const h = call(s).send({ type: "agent_declined", agentId: "b" });
    expect(ringingNow(h)).toEqual(["a"]);
  });

  it("someone who stepped away since the list was made is skipped", () => {
    const h = call(s);
    h.team.find((a) => a.id === "a")!.presence = "away";
    h.expire();
    expect(ringingNow(h)).toEqual(["c"]);
  });

  it("the first to answer gets it", () => {
    const h = call(s).expire().send({ type: "agent_answered", agentId: "a" });
    expect(h.call.state).toBe("answered");
    expect(h.call.ringPlan).toBeUndefined();
  });
});

describe("round robin", () => {
  it("starts one further along on each call, wrapping round", () => {
    const h = call(settingsWith({ strategy: "round_robin" })); // priority order: B, A, C
    expect(ringingNow(h)).toEqual(["b"]);
    expect(h.effects).toContainEqual({ type: "advance_rotation", queueId: "main", memberCount: 3 });
    const next = () => h.inbound().send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    expect(ringingNow(next())).toEqual(["a"]);
    expect(ringingNow(next())).toEqual(["c"]);
    expect(ringingNow(next())).toEqual(["b"]);
  });

  it("fewer than two people: nothing to rotate", () => {
    const solo = team().map((a) => (a.id === "b" ? a : { ...a, presence: "away" as const }));
    const h = call(settingsWith({ strategy: "round_robin" }), "1", solo);
    expect(h.effects.some((e) => e.type === "advance_rotation")).toBe(false);
  });
});

describe("longest idle", () => {
  it("whoever has been free longest rings first", () => {
    const h = call(settingsWith({ strategy: "longest_idle" }));
    expect(ringingNow(h)).toEqual(["b"]); // idle since 1,000 (oldest)
    h.expire();
    expect(ringingNow(h)).toEqual(["c"]); // 2,000
  });
});

describe("Spanish callers", () => {
  it("Spanish speakers ring first; the others still ring after", () => {
    const t = team().map((a) => (a.id === "b" ? { ...a, priority: 9 } : a));
    const h = call(settingsWith({ strategy: "linear" }), "2", t);
    expect(ringingNow(h)).toEqual(["b"]);
    expect(h.kinds()).toContain("language_ordered");
    h.expire();
    expect(ringingNow(h)).toEqual(["a"]);
  });
});

describe("the caller's own agent first", () => {
  const s = settingsWith({ strategy: "linear" });

  it("the preferred agent rings first when free", () => {
    const h = call(s, "1", team(), { preferredAgentId: "c" });
    expect(ringingNow(h)).toEqual(["c"]);
    expect(h.call.timeline.find((t) => t.kind === "preferred_agent")?.detail).toBe("C rings first");
  });

  it("not if they aren't available (no special ring, no wait)", () => {
    const t = team().map((a) => (a.id === "c" ? { ...a, presence: "away" as const } : a));
    const h = call(s, "1", t, { preferredAgentId: "c" });
    expect(ringingNow(h)).toEqual(["b"]);
    expect(h.call.timeline.find((t) => t.kind === "preferred_agent")?.detail).toBe("C isn't available");
  });

  it("not for a Spanish caller when that agent doesn't speak Spanish", () => {
    const h = call(s, "2", team(), { preferredAgentId: "a" });
    expect(ringingNow(h)).toEqual(["b"]);
    expect(h.call.timeline.find((t) => t.kind === "preferred_agent")?.detail).toBe("A doesn't speak Spanish");
  });
});

describe("overflow", () => {
  const backup: QueueSettings = { id: "backup", name: "Backup", ringSeconds: RING };

  it("to another queue: it rings that queue once", () => {
    const h = call(settingsWith({ overflow: { action: "queue", queueId: "backup" } }, [backup])).expire();
    expect(h.call.queueId).toBe("backup");
    expect(ringingNow(h).sort()).toEqual(["c", "d"]);
    expect(h.kinds()).toContain("overflow");
  });

  it("…and never chains on: when the second queue rings out, the caller leaves a message", () => {
    const loop: QueueSettings = { ...backup, overflow: { action: "queue", queueId: "main" } };
    const h = call(settingsWith({ overflow: { action: "queue", queueId: "backup" } }, [loop])).expire().expire();
    expect(h.call.state).toBe("voicemail");
  });

  it("'hangup': the caller hears that nobody is available, and it counts as missed", () => {
    const h = call(settingsWith({ overflow: { action: "hangup" } })).expire();
    expect(h.effects).toContainEqual({ type: "play", prompt: "no_agents", lang: "en" });
    expect(h.call.endReason).toBe("missed");
  });

  it("nobody available at all goes straight to the overflow", () => {
    const t = team().map((a) => ({ ...a, presence: "away" as const }));
    const h = call(settingsWith({ overflow: { action: "queue", queueId: "backup" } }, [backup]), "1", t);
    expect(h.call.queueId).toBe("backup");
    expect(h.call.state).toBe("voicemail"); // backup has nobody either → message
  });

  it("the default is still voicemail", () => {
    const h = call(settingsWith({})).expire();
    expect(h.call.state).toBe("voicemail");
  });
});
