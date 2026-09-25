import { describe, expect, it } from "vitest";
import { startOfDay, summarize, type CallStatRow } from "./callStats";

const NOW = Date.parse("2026-09-24T15:00:00Z"); // 11:00 in New York
const at = (s: number) => new Date(NOW - s * 1000).toISOString();
const row = (id: string, extra: Partial<CallStatRow>): CallStatRow => ({
  id, direction: "incoming", state: "ended", agent_email: null, started_at: at(600), answered_at: null, result: null, ...extra,
});

describe("the Team page's live numbers", () => {
  it("who's on a call and who's waiting, longest first", () => {
    const live = [
      row("a", { state: "answered", agent_email: "ana@x", started_at: at(300), answered_at: at(280) }),
      row("b", { state: "ringing", started_at: at(40) }),
      row("c", { state: "menu", started_at: at(90) }),
      row("d", { state: "dialing", direction: "outgoing", agent_email: "ben@x", started_at: at(5) }),
    ];
    const s = summarize(live, [], NOW);
    expect(s.onCalls).toEqual([{ callId: "a", agent: "ana@x", direction: "incoming", sinceSeconds: 280 }]);
    expect(s.waiting).toEqual([
      { callId: "c", state: "menu", waitingSeconds: 90 },
      { callId: "b", state: "ringing", waitingSeconds: 40 },
    ]);
  });

  it("today's incoming: answered, missed, voicemail, average and longest wait, answer rate", () => {
    const today = [
      row("1", { started_at: at(3000), answered_at: at(2990), result: "answered" }), // 10 s
      row("2", { started_at: at(2000), answered_at: at(1970), result: "answered" }), // 30 s
      row("3", { result: "missed" }),
      row("4", { result: "voicemail" }),
      row("5", { state: "ringing", started_at: at(10) }), // still ringing: not counted in the rate
      row("6", { direction: "outgoing", agent_email: "ana@x" }),
    ];
    expect(summarize([], today, NOW).today).toEqual({
      incoming: 5, answered: 2, missed: 1, voicemail: 1, outgoing: 1,
      averageAnswerSeconds: 20, longestAnswerSeconds: 30, answerRate: 50,
    });
  });

  it("a quiet day has no averages instead of zeros", () => {
    expect(summarize([], [], NOW).today).toMatchObject({ incoming: 0, averageAnswerSeconds: null, answerRate: null });
  });

  it("today starts at midnight New York time, summer and winter", () => {
    expect(new Date(startOfDay(NOW)).toISOString()).toBe("2026-09-24T04:00:00.000Z");
    expect(new Date(startOfDay(Date.parse("2026-12-11T03:30:00Z"))).toISOString()).toBe("2026-12-10T05:00:00.000Z");
  });
});
