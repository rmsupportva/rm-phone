/**
 * The old phone's queue "callback offer" (queues.callback_offer_enabled):
 * only when nobody at all can be rung; press 1 within 6 s → a callback is
 * saved and the call ends; anything else → the caller leaves a message.
 */
import { describe, expect, it } from "vitest";
import { scriptFor } from "./callerScript";
import { DEMO_SETTINGS, PROMPTS, type PhoneSettings } from "./settings";
import { OPEN, agents, harness } from "./testHarness";
import type { Agent } from "./types";

const WITH_OFFER: PhoneSettings = { ...DEMO_SETTINGS, queue: { ...DEMO_SETTINGS.queue, callbackOffer: true } };
const nobodyFree = (): Agent[] => agents().map((a) => ({ ...a, presence: "away" }));

/** Caller presses 1, 1 with nobody available. */
const reachQueue = (settings = WITH_OFFER, team = nobodyFree()) =>
  harness(OPEN, team, settings).inbound().send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });

describe("callback offer", () => {
  it("nobody free: offers 'press 1 for a callback', waiting 6 seconds for a key", () => {
    const h = reachQueue();
    expect(h.call.state).toBe("menu");
    expect(h.call.menuStep).toBe("callback_offer");
    expect(h.effects).toContainEqual({ type: "play", prompt: "callback_offer", lang: "en" });
    expect(h.call.deadline).toEqual({ kind: "menu", at: h.now + 6_000 });
    const steps = scriptFor(h.call, h.effects, h.now, DEMO_SETTINGS.voicemailMaxSeconds);
    expect(steps).toEqual([
      { kind: "say", text: PROMPTS.callback_offer.en, lang: "en", voiceLang: "en-US" },
      { kind: "gather", timeoutSec: 7 },
    ]);
  });

  it("press 1: the callback is saved, the caller is thanked, and the call ends as completed", () => {
    const h = reachQueue().send({ type: "caller_pressed", digit: "1" });
    expect(h.effects).toContainEqual({ type: "create_callback", source: "caller_requested", from: "+18455550111", lang: "en" });
    expect(h.effects).toContainEqual({ type: "play", prompt: "callback_confirmed", lang: "en" });
    expect(h.call.endReason).toBe("completed");
    expect(h.kinds()).toContain("callback_requested");
  });

  it("any other key: straight to leaving a message", () => {
    const h = reachQueue().send({ type: "caller_pressed", digit: "5" });
    expect(h.call.state).toBe("voicemail");
    expect(h.effects.some((e) => e.type === "create_callback")).toBe(false);
  });

  it("no key in 6 seconds: leave a message", () => {
    const h = reachQueue().expire();
    expect(h.call.state).toBe("voicemail");
  });

  it("in Spanish for a Spanish caller", () => {
    const h = harness(OPEN, nobodyFree(), WITH_OFFER).inbound();
    h.send({ type: "caller_pressed", digit: "2" }).send({ type: "caller_pressed", digit: "1" });
    expect(h.effects).toContainEqual({ type: "play", prompt: "callback_offer", lang: "es" });
    h.send({ type: "caller_pressed", digit: "1" });
    expect(h.effects).toContainEqual({ type: "create_callback", source: "caller_requested", from: "+18455550111", lang: "es" });
  });

  it("not offered when someone can be rung", () => {
    const h = reachQueue(WITH_OFFER, agents());
    expect(h.call.state).toBe("ringing");
  });

  it("off (the default): nobody free goes straight to voicemail, as before", () => {
    const h = reachQueue(DEMO_SETTINGS);
    expect(h.call.state).toBe("voicemail");
    expect(h.effects).toContainEqual({ type: "play", prompt: "all_busy", lang: "en" });
  });
});
