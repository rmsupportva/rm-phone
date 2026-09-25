import { describe, expect, it } from "vitest";
import { scriptFor } from "./callerScript";
import { defaultFlow } from "./ivr";
import { checkSaved, withSaved, type SavedSettings } from "./savedSettings";
import { DEMO_SETTINGS } from "./settings";
import { CLOSED, OPEN, agents, harness } from "./testHarness";

const problems = (raw: unknown) => {
  const r = checkSaved(raw);
  return r.ok ? [] : r.problems;
};

describe("checking saved settings", () => {
  it("accepts a full, sensible record", () => {
    const saved: SavedSettings = {
      hours: {
        weekly: [null, { open: "08:30", close: "17:00" }, null, null, null, { open: "09:00", close: "13:00" }, null],
        holidays: [{ date: "2026-12-25", name: "Office closed" }],
        earlyCloses: [{ date: "2026-12-24", closeAt: "14:00", reason: "Early close" }],
      },
      routing: "ivr",
      ivr: defaultFlow("screening", 10),
      afterHours: { action: "hangup" },
      queue: { ringSeconds: 40, strategy: "round_robin", overflow: "voicemail", callbackOffer: true },
      menuSeconds: 8,
      voicemailMaxSeconds: 180,
      dialSeconds: 60,
      recording: { mode: "all", announce: true },
      postCallFeedback: false,
      missedCallbacks: true,
      returningCallers: { withinDays: 14 },
      prompts: { all_busy: { en: "Everyone is helping other families.", es: "Todos están ayudando a otras familias." } },
    };
    expect(problems(saved)).toEqual([]);
    expect(problems({})).toEqual([]);
  });

  it("refuses unknown settings and things that can't be changed here", () => {
    expect(problems({ mainNumber: "+18005550100" })).toEqual(['Unknown setting "mainNumber".']);
    expect(problems({ queue: { id: "other" } })).toEqual(['Unknown ringing setting "id".']);
    expect(problems([])).toEqual(["Settings must be an object."]);
  });

  it("refuses numbers out of range", () => {
    expect(problems({ queue: { ringSeconds: 2 } })).toEqual(["Ring time must be a whole number from 5 to 120."]);
    expect(problems({ menuSeconds: 1.5 })).toHaveLength(1);
    expect(problems({ voicemailMaxSeconds: 1000 })).toHaveLength(1);
    expect(problems({ returningCallers: { withinDays: 0 } })).toHaveLength(1);
  });

  it("refuses bad hours", () => {
    expect(problems({ hours: { weekly: [] } })).toEqual(["Office hours need all 7 days."]);
    const late = [null, { open: "17:00", close: "09:00" }, null, null, null, null, null];
    expect(problems({ hours: { weekly: late } })).toEqual(["Day 1: closing must be after opening."]);
    expect(problems({ hours: { holidays: [{ date: "12/25/2026", name: "x" }] } })).toHaveLength(1);
    expect(problems({ hours: { earlyCloses: [{ date: "2026-12-24", closeAt: "25:00", reason: "x" }] } })).toHaveLength(1);
  });

  it("refuses a broken phone menu, and outside numbers that aren't in the US", () => {
    expect(problems({ ivr: { rootId: "nope", nodes: [] } })).toContain('Phone menu: The first step "nope" doesn\'t exist.');
    const abroad = { rootId: "d", nodes: [{ id: "d", type: "dial", to: { kind: "external", number: "+442071234567" } }] };
    expect(problems({ ivr: abroad })).toEqual(['Phone menu: "d" must dial a US number like +17185550100.']);
  });

  it("refuses empty, unknown or overlong messages", () => {
    expect(problems({ prompts: { nope: { en: "a", es: "b" } } })).toEqual(['Unknown message "nope".']);
    expect(problems({ prompts: { closed: { en: "We're closed", es: " " } } })).toEqual(['Message "closed" can\'t be empty.']);
    expect(problems({ prompts: { closed: { en: "x".repeat(601), es: "y" } } })).toHaveLength(1);
  });
});

describe("saved settings change what callers get", () => {
  it("edited wording is what the caller hears", () => {
    const settings = withSaved(DEMO_SETTINGS, { prompts: { closed: { en: "Closed for now.", es: "Cerrado por ahora." } } });
    const h = harness(CLOSED, agents(), settings).inbound();
    const steps = scriptFor(h.call, h.effects, h.now, { maxVoicemailSeconds: settings.voicemailMaxSeconds, prompts: settings.prompts });
    expect(steps[0]).toMatchObject({ kind: "say", text: "Closed for now." });
  });

  it("ring time, strategy and missed-call callbacks take effect", () => {
    const settings = withSaved(DEMO_SETTINGS, { routing: "queue", queue: { ringSeconds: 12, strategy: "linear" }, missedCallbacks: false });
    const h = harness(OPEN, agents(), settings).inbound();
    expect(h.call.ringingAgentIds).toHaveLength(1);
    expect(h.call.deadline).toMatchObject({ kind: "ring", at: OPEN + 12_000 });
    expect(settings.missedCallbacks).toBe(false);
  });

  it("null clears a setting back to the default", () => {
    const withMenu = withSaved(DEMO_SETTINGS, { ivr: defaultFlow("screening", 5), returningCallers: null, recording: null });
    expect(withMenu.ivr).toBeDefined();
    expect(withMenu.returningCallers).toBeUndefined();
    expect(withSaved(withMenu, { ivr: null }).ivr).toBeUndefined();
  });

  it("the main number and queue can't be changed, and nothing leaks into the defaults", () => {
    const before = JSON.stringify(DEMO_SETTINGS);
    const s = withSaved(DEMO_SETTINGS, { queue: { ringSeconds: 60 }, afterHours: { action: "queue" }, hours: { holidays: [] } });
    expect(s.mainNumber).toBe(DEMO_SETTINGS.mainNumber);
    expect(s.queue.id).toBe("screening");
    expect(s.afterHours).toEqual({ action: "queue", queueId: "screening" });
    expect(s.hours.weekly).toBe(DEMO_SETTINGS.hours.weekly);
    expect(JSON.stringify(DEMO_SETTINGS)).toBe(before);
  });
});
