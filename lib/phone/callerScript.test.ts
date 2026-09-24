import { describe, expect, it } from "vitest";
import { roomFor, scriptFor, type CallerStep } from "./callerScript";
import { DEMO_SETTINGS, PROMPTS } from "./settings";
import { CLOSED, OPEN, agents, harness } from "./testHarness";

const MAX = DEMO_SETTINGS.voicemailMaxSeconds;
const script = (h: ReturnType<typeof harness>) => scriptFor(h.call, h.effects, h.now, MAX);
const kinds = (steps: CallerStep[]) => steps.map((s) => s.kind);

describe("what an inbound caller hears", () => {
  it("first: the welcome, then one key with a timeout just past the menu deadline", () => {
    const steps = script(harness(OPEN).inbound());
    expect(steps[0]).toEqual({ kind: "say", text: PROMPTS.welcome_language.en, lang: "en", voiceLang: "en-US" });
    expect(steps[1]).toEqual({ kind: "gather", timeoutSec: DEMO_SETTINGS.menuSeconds + 1 });
  });

  it("the timeout counts down: a re-render later waits only for what's left", () => {
    const h = harness(OPEN).inbound().wait(10);
    expect(scriptFor(h.call, [], h.now, MAX)).toEqual([
      { kind: "say", text: PROMPTS.welcome_language.en, lang: "en", voiceLang: "en-US" },
      { kind: "gather", timeoutSec: DEMO_SETTINGS.menuSeconds - 10 + 1 },
    ]);
  });

  it("after pressing 2 for Spanish, the main menu is in Spanish", () => {
    const h = harness(OPEN).inbound().send({ type: "caller_pressed", digit: "2" });
    const [say, gather] = script(h);
    expect(say).toMatchObject({ kind: "say", text: PROMPTS.main_menu.es, voiceLang: "es-US" });
    expect(gather.kind).toBe("gather");
  });

  it("while the team rings: please hold, then wait in the call's room", () => {
    const h = harness(OPEN).inbound().send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" });
    expect(script(h)).toEqual([
      { kind: "say", text: PROMPTS.please_hold.en, lang: "en", voiceLang: "en-US" },
      { kind: "hold", room: roomFor(h.call) },
    ]);
  });

  it("answered: talk in the same room", () => {
    const h = harness(OPEN).answeredBy("a");
    expect(script(h)).toEqual([{ kind: "bridge", room: roomFor(h.call) }]);
  });

  it("nobody answers: 'everyone is busy', the greeting, then record after a beep", () => {
    const h = harness(OPEN).inbound().send({ type: "caller_pressed", digit: "1" }).send({ type: "caller_pressed", digit: "1" }).expire();
    const steps = script(h);
    expect(kinds(steps)).toEqual(["say", "say", "record"]);
    expect(steps[0]).toMatchObject({ text: PROMPTS.all_busy.en });
    expect(steps[1]).toMatchObject({ text: PROMPTS.voicemail_greeting.en });
    expect(steps[2]).toEqual({ kind: "record", maxSeconds: MAX, beep: true, finishOnKey: "#", silenceTimeoutSec: 7 });
  });

  it("after hours: 'we're closed', the greeting, record", () => {
    const steps = script(harness(CLOSED).inbound());
    expect(steps.map((s) => (s.kind === "say" ? s.text : s.kind))).toEqual([
      PROMPTS.closed.en,
      PROMPTS.voicemail_greeting.en,
      "record",
    ]);
  });

  it("a re-rendered voicemail step still plays the greeting before the beep", () => {
    const h = harness(CLOSED).inbound();
    expect(kinds(scriptFor(h.call, [], h.now, MAX))).toEqual(["say", "record"]);
  });

  it("parked: back to waiting in the room with hold music", () => {
    const team = agents().map((a) => ({ ...a, presence: "available" as const }));
    const h = harness(OPEN, team).answeredBy("a").send({ type: "park", agentId: "a" });
    expect(script(h)).toEqual([{ kind: "hold", room: roomFor(h.call) }]);
  });

  it("the call is over: hang up", () => {
    const h = harness(CLOSED).inbound().send({ type: "voicemail_saved", recording: { id: "r", seconds: 9 } });
    expect(script(h)).toEqual([{ kind: "hangup" }]);
  });

  it("outbound calls have no caller script", () => {
    expect(script(harness(OPEN).outbound())).toEqual([]);
  });
});
