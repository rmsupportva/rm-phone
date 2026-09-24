import { describe, expect, it } from "vitest";
import { chooseCallerId, chooseCallingNumber, doNotCallGate, isOnDoNotCall, type VoiceNumber } from "./outbound";

const n = (e164: string, extra: Partial<VoiceNumber> = {}): VoiceNumber => ({ e164, active: true, providerRef: `sid-${e164}`, ...extra });

describe("which number an agent calls from", () => {
  it("prefers a number attached to one of the agent's queues", () => {
    const numbers = [n("+17185550001", { queueId: "other" }), n("+19145550002", { queueId: "mine" })];
    expect(chooseCallingNumber(numbers, ["mine"])?.e164).toBe("+19145550002");
  });

  it("otherwise the lowest number", () => {
    expect(chooseCallingNumber([n("+19145550002"), n("+17185550001")], [])?.e164).toBe("+17185550001");
  });

  it("never a placeholder that was never provisioned, when a real one exists (the old live bug)", () => {
    const numbers = [n("+17185550100", { providerRef: null, queueId: "mine" }), n("+19144294219", { queueId: "mine" })];
    expect(chooseCallingNumber(numbers, ["mine"])?.e164).toBe("+19144294219");
  });

  it("skips inactive numbers; none at all means the call is refused", () => {
    expect(chooseCallingNumber([n("+17185550001", { active: false })], [])).toBeNull();
    expect(chooseCallingNumber([], [])).toBeNull();
  });
});

describe("the caller id the other side sees", () => {
  const calling = n("+19145550002");
  it("the line's default outbound number first", () => {
    expect(chooseCallerId([calling, n("+18554993663", { isDefaultOutbound: true })], calling, "+18455550155")).toBe("+18554993663");
  });
  it("then a verified outside default", () => {
    expect(chooseCallerId([calling], calling, "+18455550155")).toBe("+18455550155");
  });
  it("then the number we call from", () => {
    expect(chooseCallerId([calling], calling, null)).toBe("+19145550002");
  });
  it("an inactive default is ignored", () => {
    expect(chooseCallerId([calling, n("+18554993663", { isDefaultOutbound: true, active: false })], calling)).toBe("+19145550002");
  });
});

describe("Do Not Call", () => {
  it("matches on the last 10 digits, whatever the format", () => {
    expect(isOnDoNotCall(["(845) 555-0111"], "+18455550111")).toBe(true);
    expect(isOnDoNotCall(["18455550111"], "+18455550112")).toBe(false);
  });
  it("refuses a listed number with a reason", () => {
    expect(doNotCallGate("+18455550111", ["+18455550111"])).toEqual({
      ok: false,
      reason: "That number is on the Do Not Call list, so the call was not placed.",
    });
  });
  it("an unreadable list does not block the call (old behaviour; the caller reports it)", () => {
    expect(doNotCallGate("+18455550111", null)).toEqual({ ok: true });
  });
});
