/**
 * CallsTable for Supabase: the phone_calls, phone_call_events and
 * phone_presence tables (bronx-survey migration 0012_phone.sql).
 *
 * SERVER ONLY. Pass a service-role client; these tables are closed to anon and
 * authenticated users by RLS. Agent ids in the engine are the agents' emails.
 *
 * The whole engine Call lives in `machine` (jsonb). The other columns are
 * copies for queries and screens, rewritten on every save. `provider_sid` is
 * set on insert only and never overwritten.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Agent, Call, EndReason, Presence, TimelineEntry, TimerKind } from "../types";
import type { CallsTable, StoredCall } from "./callRunner";

/** phone_calls.result: what the screens show for a finished call. */
export type CallResult = "answered" | "missed" | "voicemail" | "no_answer" | "failed" | "transferred";

export function resultFor(call: Call): CallResult | null {
  if (call.state !== "ended") return null;
  const r: EndReason | undefined = call.endReason;
  if (r === "transferred") return "transferred";
  if (r === "voicemail") return "voicemail";
  if (r === "completed" || (r === "timed_out" && call.answeredAt !== undefined)) return "answered";
  if (r === "missed" || r === "abandoned_menu") return "missed";
  if (r === "no_answer" || r === "cancelled") return "no_answer";
  return "failed";
}

const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());

/** The phone_calls columns derived from the engine's call. */
export function toRow(call: Call) {
  return {
    id: call.id,
    direction: call.direction === "inbound" ? "incoming" : "outgoing",
    from_e164: call.from,
    to_e164: call.to,
    agent_email: call.agentId ?? null,
    state: call.state,
    machine: call,
    deadline_at: iso(call.deadline?.at),
    deadline_kind: call.deadline?.kind ?? null,
    started_at: iso(call.startedAt),
    answered_at: iso(call.answeredAt),
    ended_at: iso(call.endedAt),
    seconds: call.talkSeconds ?? 0, // NOT NULL in phone_calls: 0 until a conversation ends
    result: resultFor(call),
    recorded: Boolean(call.recording),
  };
}

/** phone_presence.state ↔ the engine's presence. */
const PRESENCE_TO_ROW: Record<Presence, string> = {
  available: "available",
  busy: "on_call",
  wrap_up: "wrapup",
  away: "away",
  offline: "offline",
};

export function presenceFromRow(state: string): Presence {
  switch (state) {
    case "available":
      return "available";
    case "on_call":
      return "busy";
    case "wrapup":
      return "wrap_up";
    case "offline":
      return "offline";
    default:
      return "away"; // "paused" and "away" both mean: don't ring me
  }
}

/**
 * The team as the engine sees it, from phone_presence. Everyone is on the one
 * main line for now; names are the part of the email before the @.
 */
export async function loadTeam(db: SupabaseClient, queueId: string): Promise<Agent[]> {
  const { data, error } = await db.from("phone_presence").select("agent_email, state");
  if (error) throw new Error(`load team: ${error.message}`);
  return (data ?? []).map((r: { agent_email: string; state: string }) => ({
    id: r.agent_email,
    name: r.agent_email.split("@")[0],
    presence: presenceFromRow(r.state),
    speaksSpanish: false,
    queueIds: [queueId],
  }));
}

export function supabaseCallsTable(db: SupabaseClient): CallsTable {
  const fail = (what: string, error: { message: string }) => new Error(`${what}: ${error.message}`);

  const toStored = (row: { machine: Call; version: number } | null): StoredCall | null =>
    row ? { call: row.machine, version: row.version } : null;

  return {
    async load(callId) {
      const { data, error } = await db.from("phone_calls").select("machine, version").eq("id", callId).maybeSingle();
      if (error) throw fail("load call", error);
      return toStored(data);
    },

    async findByProviderSid(providerSid) {
      const { data, error } = await db
        .from("phone_calls")
        .select("machine, version")
        .eq("provider_sid", providerSid)
        .maybeSingle();
      if (error) throw fail("find call", error);
      return toStored(data);
    },

    async insert(call, providerSid) {
      const { error } = await db.from("phone_calls").insert({ ...toRow(call), provider_sid: providerSid ?? null, version: 0 });
      if (!error) return true;
      if (error.code === "23505") return false; // unique violation: the carrier retried a webhook
      throw fail("insert call", error);
    },

    async update(call, expectedVersion) {
      const { data, error } = await db
        .from("phone_calls")
        .update({ ...toRow(call), version: expectedVersion + 1 })
        .eq("id", call.id)
        .eq("version", expectedVersion)
        .select("id");
      if (error) throw fail("update call", error);
      return (data?.length ?? 0) === 1;
    },

    async appendEvents(callId, entries: TimelineEntry[]) {
      const rows = entries.map((e) => ({
        call_id: callId,
        at: new Date(e.at).toISOString(),
        type: e.kind,
        detail: e.detail === undefined ? {} : { detail: e.detail },
      }));
      const { error } = await db.from("phone_call_events").insert(rows);
      if (error) throw fail("append call events", error);
    },

    async dueDeadlines(now, limit) {
      const { data, error } = await db
        .from("phone_calls")
        .select("id, deadline_kind")
        .not("deadline_at", "is", null)
        .lte("deadline_at", new Date(now).toISOString())
        .order("deadline_at", { ascending: true })
        .limit(limit);
      if (error) throw fail("find due deadlines", error);
      return (data ?? []).map((r: { id: string; deadline_kind: string }) => ({ id: r.id, kind: r.deadline_kind as TimerKind }));
    },

    async setPresence(agentId, presence) {
      const { error } = await db
        .from("phone_presence")
        .upsert({ agent_email: agentId, state: PRESENCE_TO_ROW[presence], since: new Date().toISOString() }, { onConflict: "agent_email" });
      if (error) throw fail("set presence", error);
    },
  };
}
