/**
 * Missed calls and voicemails go on the callback list, so nobody who called
 * is forgotten. Answered calls and calls that already asked for a callback don't.
 */
import { describe, expect, it } from "vitest";
import { DEMO_SETTINGS } from "./settings";
import { CLOSED, OPEN, agents, harness } from "./testHarness";
import type { Effect } from "./types";

const callbacks = (fx: Effect[]) => fx.filter((e) => e.type === "create_callback");
const nobodyIn = () => agents().map((a) => ({ ...a, presence: "away" as const }));

describe("missed calls go on the callback list", () => {
  it("a message left: one 'voicemail' callback in the caller's language", () => {
    const h = harness(OPEN).inbound().send({ type: "caller_pressed", digit: "2" }).send({ type: "caller_pressed", digit: "2" });
    h.send({ type: "voicemail_saved", recording: { id: "RE-1", seconds: 20 } });
    expect(callbacks(h.effects)).toEqual([{ type: "create_callback", source: "voicemail", from: "+18455550111", lang: "es" }]);
  });

  it("hung up while waiting: one 'missed' callback", () => {
    const h = harness(OPEN).inbound().send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    h.send({ type: "caller_hung_up" });
    expect(h.call.endReason).toBe("missed");
    expect(callbacks(h.effects)).toEqual([{ type: "create_callback", source: "missed", from: "+18455550111", lang: "en" }]);
  });

  it("after hours, hanging up at the greeting is a missed call to return", () => {
    const h = harness(CLOSED).inbound().send({ type: "caller_hung_up" });
    expect(callbacks(h.effects)).toMatchObject([{ source: "missed" }]);
  });

  it("an answered call is not put on the list", () => {
    const h = harness(OPEN).answeredBy("a").wait(30).send({ type: "caller_hung_up" });
    expect(h.call.endReason).toBe("completed");
    expect(callbacks(h.effects)).toEqual([]);
  });

  it("a caller who pressed 1 for a callback gets exactly one", () => {
    const settings = { ...DEMO_SETTINGS, queue: { ...DEMO_SETTINGS.queue, callbackOffer: true } };
    const h = harness(OPEN, nobodyIn(), settings).inbound().send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    h.send({ type: "caller_pressed", digit: "1" });
    expect(callbacks(h.effects)).toMatchObject([{ source: "caller_requested" }]);
  });

  it("outgoing calls nobody answered are not put on the list", () => {
    const h = harness(OPEN).outbound().expire();
    expect(callbacks(h.effects)).toEqual([]);
  });

  it("switched off: nothing is added", () => {
    const h = harness(OPEN, agents(), { ...DEMO_SETTINGS, missedCallbacks: false }).inbound().send({ type: "caller_hung_up" });
    expect(callbacks(h.effects)).toEqual([]);
  });

  it("an event after the call ended adds nothing more", () => {
    const h = harness(OPEN).inbound().send({ type: "caller_hung_up" }).send({ type: "caller_hung_up" });
    expect(callbacks(h.effects)).toEqual([]);
  });
});
