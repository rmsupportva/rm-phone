/**
 * The whole inbound path the way the carrier webhooks will drive it: start the
 * call, answer each webhook with the caller's script, feed back key presses,
 * silence, answers, hang-ups and recordings — all through the database runner.
 */
import { describe, expect, it } from "vitest";
import { scriptFor } from "../callerScript";
import type { MachineContext } from "../callMachine";
import { DEMO_SETTINGS } from "../settings";
import { CLOSED, OPEN, agents } from "../testHarness";
import type { Agent, CallInput } from "../types";
import { applyInput, startInboundCall, sweepDeadlines, type RunResult, type RunnerDeps } from "./callRunner";
import { MemoryTable } from "./memoryTable";

function line(start = OPEN) {
  const table = new MemoryTable();
  let now = start;
  const team: Agent[] = agents();
  const deps: RunnerDeps = {
    table,
    context: async (): Promise<MachineContext> => ({
      now,
      settings: DEMO_SETTINGS,
      agents: team.map((a) => ({ ...a, presence: table.presence.get(a.id) ?? a.presence })),
    }),
    reportError: (source) => {
      throw new Error(`unexpected error report: ${source}`);
    },
  };
  /** What the webhook answers with, as step kinds (say/gather/hold/…). */
  const heard = (r: RunResult | null) => {
    if (!r) throw new Error("no result");
    return scriptFor(r.call, r.effects, now, DEMO_SETTINGS.voicemailMaxSeconds).map((s) => s.kind);
  };
  return {
    table,
    heard,
    wait: (s: number) => (now += s * 1000),
    now: () => now,
    ring: () => startInboundCall(deps, "call-1", "+18455550111", "CA-1"),
    send: (input: CallInput) => applyInput(deps, "call-1", input),
    sweep: () => sweepDeadlines(deps, now),
    state: () => table.rows.get("call-1")?.call.state,
  };
}

describe("an inbound call, webhook by webhook", () => {
  it("menu → queue → answered → caller hangs up", async () => {
    const t = line();
    expect(t.heard(await t.ring())).toEqual(["say", "gather"]);
    expect(t.heard(await t.send({ type: "caller_pressed", digit: "1" }))).toEqual(["say", "gather"]);
    expect(t.heard(await t.send({ type: "caller_pressed", digit: "1" }))).toEqual(["say", "hold"]);
    const answered = await t.send({ type: "agent_answered", agentId: "a" });
    expect(answered?.effects).toContainEqual({ type: "connect", agentId: "a" });
    t.wait(60);
    const done = await t.send({ type: "caller_hung_up" });
    expect(done?.call.endReason).toBe("completed");
    expect(done?.call.talkSeconds).toBe(60);
  });

  it("silence at the menu: the gather times out just after the deadline, and the timer moves the call on", async () => {
    const t = line();
    const first = await t.ring();
    const [, gather] = scriptFor(first!.call, first!.effects, t.now(), DEMO_SETTINGS.voicemailMaxSeconds);
    expect(gather).toMatchObject({ kind: "gather" });
    t.wait(gather.kind === "gather" ? gather.timeoutSec : 0);
    // No key: the adapter feeds the menu timer. English is chosen and the main menu plays.
    const next = await t.send({ type: "timer", kind: "menu" });
    expect(next?.call.menuStep).toBe("main");
    expect(t.heard(next)).toEqual(["say", "gather"]);
  });

  it("nobody answers: the sweep sends the caller to voicemail, and the message is kept", async () => {
    const t = line();
    await t.ring();
    await t.send({ type: "caller_pressed", digit: "1" });
    await t.send({ type: "caller_pressed", digit: "1" });
    t.wait(DEMO_SETTINGS.queue.ringSeconds);
    const [moved] = await t.sweep();
    expect(t.heard(moved)).toEqual(["say", "say", "record"]);
    const saved = await t.send({ type: "voicemail_saved", recording: { id: "RE-1", seconds: 14 } });
    expect(saved?.call.endReason).toBe("voicemail");
    expect(t.heard(saved)).toEqual(["hangup"]);
  });

  it("after hours, hanging up during the greeting is a missed call to return", async () => {
    const t = line(CLOSED);
    expect(t.heard(await t.ring())).toEqual(["say", "say", "record"]);
    t.wait(4);
    const gone = await t.send({ type: "caller_hung_up" });
    expect(gone?.call.endReason).toBe("missed");
  });

  it("a retried start webhook changes nothing", async () => {
    const t = line();
    await t.ring();
    expect(await t.ring()).toBeNull();
    expect(t.table.rows.size).toBe(1);
    expect(t.state()).toBe("menu");
  });
});
