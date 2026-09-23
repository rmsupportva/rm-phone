import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { PhoneEngine } from "./engine";
import { MockProvider } from "./mock/mockProvider";
import { DEMO_SETTINGS } from "./settings";
import { MemoryStore } from "./store";
import type { Agent } from "./types";

const OPEN = Date.parse("2026-09-22T11:00:00-04:00");
const CLOSED = Date.parse("2026-09-22T19:00:00-04:00");

function setup(start = OPEN) {
  let n = 0;
  const newId = () => `id-${++n}`;
  const clock = new ManualClock(start);
  const team: Agent[] = [
    { id: "a", name: "A", presence: "available", speaksSpanish: false, queueIds: ["screening"] },
    { id: "b", name: "B", presence: "available", speaksSpanish: true, queueIds: ["screening"] },
  ];
  const store = new MemoryStore({ calls: [], agents: team });
  const provider = new MockProvider({
    clock,
    newId,
    greetingSeconds: DEMO_SETTINGS.voicemailGreetingSeconds,
  });
  const errors: string[] = [];
  const engine = new PhoneEngine({
    store,
    provider,
    clock,
    settings: DEMO_SETTINGS,
    newId,
    reportError: (source) => errors.push(source),
  });
  engine.start();
  const call = (id: string) => store.getCall(id)!;
  const agent = (id: string) => store.getAgents().find((a) => a.id === id)!;
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  return { clock, store, provider, engine, errors, call, agent, flush };
}

describe("engine + pretend phone company", () => {
  it("a full answered call ends with a recording and transcript", async () => {
    const t = setup();
    const id = t.provider.placeInboundCall("+18455550111");
    t.provider.press(id, "1");
    t.provider.press(id, "1");
    expect(t.call(id).state).toBe("ringing");

    t.clock.advance(4);
    t.engine.answer(id, "a");
    expect(t.call(id).state).toBe("answered");
    expect(t.agent("a").presence).toBe("busy");

    t.clock.advance(42);
    t.provider.callerHangsUp(id);
    expect(t.call(id).endReason).toBe("completed");
    expect(t.agent("a").presence).toBe("wrap_up");

    await t.flush();
    expect(t.call(id).recording?.seconds).toBe(42);
    expect(t.call(id).transcript?.length).toBeGreaterThan(0);
    expect(t.errors).toEqual([]);
  });

  it("the ring deadline is fired by tick(), with no timers kept in memory", () => {
    const t = setup();
    const id = t.provider.placeInboundCall("+18455550111");
    t.provider.press(id, "1");
    t.provider.press(id, "1");
    t.clock.advance(29);
    t.engine.tick();
    expect(t.call(id).state).toBe("ringing");
    t.clock.advance(1);
    t.engine.tick();
    expect(t.call(id).state).toBe("voicemail");
  });

  it("hanging up after the greeting keeps what the caller said", () => {
    const t = setup(CLOSED);
    const id = t.provider.placeInboundCall("+18455550111");
    t.clock.advance(DEMO_SETTINGS.voicemailGreetingSeconds + 8);
    t.provider.callerHangsUp(id);
    expect(t.call(id).endReason).toBe("voicemail");
    expect(t.call(id).voicemail?.seconds).toBe(8);
  });

  it("hanging up during the greeting is a missed call", () => {
    const t = setup(CLOSED);
    const id = t.provider.placeInboundCall("+18455550111");
    t.clock.advance(3);
    t.provider.callerHangsUp(id);
    expect(t.call(id).endReason).toBe("missed");
  });

  it("an agent stepping away stops their phone ringing", () => {
    const t = setup();
    const id = t.provider.placeInboundCall("+18455550111");
    t.provider.press(id, "1");
    t.provider.press(id, "1");
    t.engine.setPresence("a", "away");
    expect(t.call(id).ringingAgentIds).toEqual(["b"]);
    t.engine.setPresence("b", "away");
    expect(t.call(id).state).toBe("voicemail");
  });

  it("outbound: the far end answers, the agent hangs up", async () => {
    const t = setup();
    const id = t.engine.placeOutbound("a", "+18455550122");
    expect(t.call(id).state).toBe("dialing");
    t.clock.advance(5);
    t.provider.farEndAnswers(id);
    t.clock.advance(20);
    t.engine.hangUp(id, "a");
    expect(t.call(id).endReason).toBe("completed");
    await t.flush();
    expect(t.call(id).recording?.seconds).toBe(20);
  });

  it("refuses to dial for an agent who is not available, and reports it", () => {
    const t = setup();
    t.engine.setPresence("a", "away");
    t.engine.placeOutbound("a", "+18455550122");
    expect(t.store.listCalls()).toEqual([]);
    expect(t.errors).toEqual(["engine.placeOutbound"]);
  });

  it("an input for an unknown call is reported, not thrown", () => {
    const t = setup();
    t.engine.answer("nope", "a");
    expect(t.errors).toEqual(["engine.step"]);
  });
});
