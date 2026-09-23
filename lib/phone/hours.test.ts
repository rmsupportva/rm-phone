import { describe, expect, it } from "vitest";
import { evaluateHours } from "./hours";
import { DEMO_SETTINGS, type HoursSettings } from "./settings";

const hours = DEMO_SETTINGS.hours;
const at = (iso: string) => Date.parse(iso);

describe("evaluateHours", () => {
  it("is open on a weekday during hours", () => {
    const d = evaluateHours(at("2026-09-22T11:00:00-04:00"), hours);
    expect(d.state).toBe("open");
    expect(d.label).toBe("Open until 17:00");
  });

  it("is closed before opening and from closing time on", () => {
    expect(evaluateHours(at("2026-09-22T08:59:00-04:00"), hours).state).toBe("closed");
    expect(evaluateHours(at("2026-09-22T17:00:00-04:00"), hours).state).toBe("closed");
    expect(evaluateHours(at("2026-09-22T16:59:00-04:00"), hours).state).toBe("open");
  });

  it("is closed on Shabbat and Sunday", () => {
    expect(evaluateHours(at("2026-09-19T11:00:00-04:00"), hours).state).toBe("closed");
    expect(evaluateHours(at("2026-09-20T11:00:00-04:00"), hours).state).toBe("closed");
  });

  it("is closed on a holiday, including Chol HaMoed", () => {
    const d = evaluateHours(at("2026-09-28T11:00:00-04:00"), hours);
    expect(d.state).toBe("holiday");
    expect(d.label).toBe("Closed: Chol HaMoed Sukkot");
  });

  it("closes early at candle lighting on a winter Friday", () => {
    const before = evaluateHours(at("2026-12-11T16:00:00-05:00"), hours);
    expect(before.state).toBe("open");
    expect(before.label).toBe("Open until 16:13");
    const after = evaluateHours(at("2026-12-11T16:13:00-05:00"), hours);
    expect(after.state).toBe("early_close");
  });

  it("uses the office time zone, not the computer's", () => {
    // 15:30 UTC is 11:30 in New York (open), even though it is 15:30 in London.
    expect(evaluateHours(at("2026-09-22T15:30:00Z"), hours).state).toBe("open");
    // 22:30 UTC is 18:30 in New York (closed).
    expect(evaluateHours(at("2026-09-22T22:30:00Z"), hours).state).toBe("closed");
  });

  it("never lets an early close make a day longer", () => {
    const late: HoursSettings = {
      ...hours,
      earlyCloses: [{ date: "2026-09-22", closeAt: "18:00", reason: "Mistake" }],
    };
    expect(evaluateHours(at("2026-09-22T17:30:00-04:00"), late).state).toBe("closed");
    expect(evaluateHours(at("2026-09-22T16:00:00-04:00"), late).label).toBe("Open until 17:00");
  });
});
