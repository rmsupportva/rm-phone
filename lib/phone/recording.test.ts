/**
 * Recording policy and the after-call rating text — the old phone's
 * call_recording_mode / call_recording_announcement / post_call_feedback_mode.
 */
import { describe, expect, it } from "vitest";
import { DEMO_SETTINGS, type PhoneSettings } from "./settings";
import { OPEN, harness } from "./testHarness";
import type { Effect } from "./types";

const recordAll = (announce: boolean): PhoneSettings => ({ ...DEMO_SETTINGS, recording: { mode: "all", announce } });
const toQueue = (s: PhoneSettings) =>
  harness(OPEN, undefined, s).inbound().send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
const plays = (fx: Effect[]) => fx.flatMap((e) => (e.type === "play" ? [e.prompt] : []));

describe("recording", () => {
  it("records from the moment the caller reaches the team, with the notice first", () => {
    const h = toQueue(recordAll(true));
    expect(plays(h.effects)).toEqual(["recording_notice", "please_hold"]);
    expect(h.effects).toContainEqual({ type: "start_recording" });
    expect(h.call.recordingStarted).toBe(true);
  });

  it("no notice when the line records without announcing", () => {
    const h = toQueue(recordAll(false));
    expect(plays(h.effects)).toEqual(["please_hold"]);
    expect(h.effects).toContainEqual({ type: "start_recording" });
  });

  it("recording off: nothing is recorded and nothing is announced", () => {
    const h = toQueue({ ...DEMO_SETTINGS, recording: { mode: "off", announce: true } });
    expect(h.effects.some((e) => e.type === "start_recording")).toBe(false);
    expect(plays(h.effects)).toEqual(["please_hold"]);
  });

  it("started once only, even when the caller rings a second queue", () => {
    const s: PhoneSettings = {
      ...recordAll(true),
      queue: { ...DEMO_SETTINGS.queue, overflow: { action: "queue", queueId: "backup" } },
      otherQueues: [{ id: "backup", name: "Backup", ringSeconds: 20 }],
    };
    const h = toQueue(s).expire();
    expect(h.call.queueId).toBe("backup");
    expect(h.effects.some((e) => e.type === "start_recording")).toBe(false);
  });

  it("outbound: recorded when the other side answers, with no notice", () => {
    const h = harness(OPEN, undefined, recordAll(true)).outbound().send({ type: "far_end_answered" });
    expect(h.effects).toEqual([{ type: "start_recording" }]);
  });

  it("not set: the engine leaves recording to the carrier adapter (no effect)", () => {
    const h = toQueue(DEMO_SETTINGS);
    expect(h.effects.some((e) => e.type === "start_recording")).toBe(false);
  });
});

describe("after-call rating text", () => {
  const withFeedback: PhoneSettings = { ...DEMO_SETTINGS, postCallFeedback: true };

  it("an answered incoming call of 15 s or more: text the caller", () => {
    const h = toQueue(withFeedback).send({ type: "agent_answered", agentId: "a" }).wait(15).send({ type: "caller_hung_up" });
    expect(h.effects).toContainEqual({ type: "send_feedback_text", to: "+18455550111", lang: "en" });
  });

  it("not under 15 s", () => {
    const h = toQueue(withFeedback).send({ type: "agent_answered", agentId: "a" }).wait(14).send({ type: "caller_hung_up" });
    expect(h.effects.some((e) => e.type === "send_feedback_text")).toBe(false);
  });

  it("not for voicemail, missed or outbound calls", () => {
    const vm = toQueue(withFeedback).expire().send({ type: "voicemail_saved", recording: { id: "r", seconds: 30 } });
    expect(vm.effects.some((e) => e.type === "send_feedback_text")).toBe(false);
    const out = harness(OPEN, undefined, withFeedback).outbound().send({ type: "far_end_answered" }).wait(60).send({ type: "caller_hung_up" });
    expect(out.effects.some((e) => e.type === "send_feedback_text")).toBe(false);
  });

  it("off (the default): never", () => {
    const h = toQueue(DEMO_SETTINGS).send({ type: "agent_answered", agentId: "a" }).wait(60).send({ type: "caller_hung_up" });
    expect(h.effects.some((e) => e.type === "send_feedback_text")).toBe(false);
  });
});
