import { describe, expect, it } from "vitest";
import type { MachineContext } from "../callMachine";
import { DEMO_SETTINGS } from "../settings";
import { OPEN, agents } from "../testHarness";
import type { Agent, Call } from "../types";
import { applyInput, startInboundCall, startOutboundCall, sweepDeadlines, type RunnerDeps } from "./callRunner";
import { MemoryTable } from "./memoryTable";
import { forwardFromRow, presenceFromRow, resultFor, toRow } from "./supabaseStore";

function setup() {
  const table = new MemoryTable();
  let now = OPEN;
  const team: Agent[] = agents();
  const errors: string[] = [];
  const deps: RunnerDeps = {
    table,
    context: async (): Promise<MachineContext> => ({
      now,
      settings: DEMO_SETTINGS,
      // Presence as saved by the runner wins over the starting team.
      agents: team.map((a) => ({ ...a, presence: table.presence.get(a.id) ?? a.presence })),
    }),
    reportError: (source) => errors.push(source),
  };
  return { table, deps, errors, advance: (s: number) => (now += s * 1000), now: () => now };
}

describe("running calls from the database", () => {
  it("starts an inbound call once, even if the carrier sends the webhook twice", async () => {
    const t = setup();
    const first = await startInboundCall(t.deps, "c1", "+18455550111", "CA123");
    const retry = await startInboundCall(t.deps, "c2", "+18455550111", "CA123");
    expect(first?.call.state).toBe("menu");
    expect(retry).toBeNull();
    expect(t.table.rows.size).toBe(1);
    expect(t.table.events.map((e) => e.entry.kind)).toEqual(["received", "hours_checked", "menu"]);
  });

  it("walks a call through, saving each step and returning the carrier's effects", async () => {
    const t = setup();
    await startInboundCall(t.deps, "c1", "+18455550111", "CA1");
    await applyInput(t.deps, "c1", { type: "caller_pressed", digit: "1" });
    const ring = await applyInput(t.deps, "c1", { type: "caller_pressed", digit: "1" });
    expect(ring?.effects).toContainEqual({ type: "ring", agentIds: ["a", "b"] });
    const answered = await applyInput(t.deps, "c1", { type: "agent_answered", agentId: "a" });
    expect(answered?.call.state).toBe("answered");
    // Presence is saved by the runner, not handed to the carrier.
    expect(answered?.effects.some((e) => e.type === "set_presence")).toBe(false);
    expect(t.table.presence.get("a")).toBe("busy");
    expect(t.table.rows.get("c1")?.version).toBe(3); // inserted at 0, then three saved steps
  });

  it("redoes a step after losing a race, so two webhooks can't both win", async () => {
    const t = setup();
    await startInboundCall(t.deps, "c1", "+18455550111", "CA1");
    await applyInput(t.deps, "c1", { type: "caller_pressed", digit: "1" });
    await applyInput(t.deps, "c1", { type: "caller_pressed", digit: "1" });

    // While A's answer is being saved, B's answer lands first.
    t.table.beforeNextUpdate = () => {
      const r = t.table.rows.get("c1")!;
      t.table.rows.set("c1", { ...r, call: { ...r.call, state: "answered", agentId: "b", answeredAt: t.now(), ringingAgentIds: [] }, version: r.version + 1 });
    };
    const late = await applyInput(t.deps, "c1", { type: "agent_answered", agentId: "a" });
    expect(t.table.rows.get("c1")?.call.agentId).toBe("b");
    // A's retry sees the call already answered: A's phone just stops ringing.
    expect(late?.effects).toEqual([{ type: "stop_ringing", agentIds: ["a"] }]);
  });

  it("the sweep fires passed deadlines, so a call never hangs open", async () => {
    const t = setup();
    await startInboundCall(t.deps, "c1", "+18455550111", "CA1");
    await applyInput(t.deps, "c1", { type: "caller_pressed", digit: "1" });
    await applyInput(t.deps, "c1", { type: "caller_pressed", digit: "1" });
    t.advance(31);
    const moved = await sweepDeadlines(t.deps, t.now());
    expect(moved).toHaveLength(1);
    expect(t.table.rows.get("c1")?.call.state).toBe("voicemail");
  });

  it("an input for an unknown call is reported, not thrown", async () => {
    const t = setup();
    expect(await applyInput(t.deps, "nope", { type: "caller_hung_up" })).toBeNull();
    expect(t.errors).toEqual(["phone.runner.unknown_call"]);
  });

  it("outbound calls start and are saved the same way", async () => {
    const t = setup();
    const r = await startOutboundCall(t.deps, "o1", "a", "+18455550122");
    expect(r?.effects).toContainEqual({ type: "dial", to: "+18455550122" });
    expect(t.table.presence.get("a")).toBe("busy");
  });
});

describe("database columns", () => {
  it("maps a finished call to the phone_calls columns", async () => {
    const t = setup();
    await startInboundCall(t.deps, "c1", "+18455550111", "CA1");
    await applyInput(t.deps, "c1", { type: "caller_pressed", digit: "1" });
    await applyInput(t.deps, "c1", { type: "caller_pressed", digit: "1" });
    await applyInput(t.deps, "c1", { type: "agent_answered", agentId: "a" });
    t.advance(90);
    const done = await applyInput(t.deps, "c1", { type: "caller_hung_up" });
    const row = toRow(done!.call);
    expect(row).toMatchObject({
      direction: "incoming",
      from_e164: "+18455550111",
      agent_email: "a",
      state: "ended",
      result: "answered",
      seconds: 90,
      deadline_at: null,
      deadline_kind: null,
    });
    expect(row.machine).toBe(done!.call);
  });

  it("a live call saves 0 talk seconds (the column is NOT NULL)", async () => {
    const t = setup();
    const r = await startInboundCall(t.deps, "c1", "+18455550111", "CA1");
    expect(toRow(r!.call).seconds).toBe(0);
  });

  it("result is null while a call is live, and every end reason has a result", () => {
    const base = { state: "ended" } as Call;
    expect(resultFor({ ...base, state: "ringing" } as Call)).toBeNull();
    expect(resultFor({ ...base, endReason: "abandoned_menu" })).toBe("missed");
    expect(resultFor({ ...base, endReason: "cancelled" })).toBe("no_answer");
    expect(resultFor({ ...base, endReason: "timed_out" })).toBe("failed");
    expect(resultFor({ ...base, endReason: "timed_out", answeredAt: 1 })).toBe("answered");
    expect(resultFor({ ...base, endReason: "transferred" })).toBe("transferred");
  });

  it("reads forwarding from phone_presence with the old phone's default and limits", () => {
    expect(forwardFromRow({ forward_to: null, forward_after_s: 10 })).toBeUndefined();
    expect(forwardFromRow({ forward_to: " +18455550177 ", forward_after_s: null })).toEqual({ to: "+18455550177", afterSec: 15, parallel: false });
    expect(forwardFromRow({ forward_to: "+18455550177", forward_after_s: 500 })?.afterSec).toBe(120);
  });

  it("reads phone_presence states; paused counts as not ringable", () => {
    expect(presenceFromRow("on_call")).toBe("busy");
    expect(presenceFromRow("wrapup")).toBe("wrap_up");
    expect(presenceFromRow("paused")).toBe("away");
  });
});
