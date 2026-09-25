/**
 * The Team page's live numbers, from the phone's call rows: who is on a call,
 * who is waiting and for how long, and today's incoming calls (answered,
 * missed, voicemail, average and longest wait before answer). Pure, so the
 * sums are tested; server/stats.ts reads the rows.
 */

export interface CallStatRow {
  id: string;
  direction: "incoming" | "outgoing";
  state: string;
  agent_email: string | null;
  started_at: string;
  answered_at: string | null;
  result: string | null;
}

export interface LiveStats {
  now: string;
  onCalls: { callId: string; agent: string | null; direction: "incoming" | "outgoing"; sinceSeconds: number }[];
  waiting: { callId: string; state: "menu" | "ringing" | "parked"; waitingSeconds: number }[];
  today: {
    incoming: number;
    answered: number;
    missed: number;
    voicemail: number;
    outgoing: number;
    /** Seconds from ringing in to answer, over today's answered incoming calls; null = none yet. */
    averageAnswerSeconds: number | null;
    longestAnswerSeconds: number | null;
    /** Answered ÷ incoming that have finished or been answered, 0–100; null = none yet. */
    answerRate: number | null;
  };
}

const secs = (from: string, to: number) => Math.max(0, Math.round((to - Date.parse(from)) / 1000));

/** Midnight today in New York, as an instant. */
export function startOfDay(now: number, timeZone = "America/New_York"): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  const sinceMidnight = (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return Math.floor(now / 1000) * 1000 - sinceMidnight;
}

/** `live` = calls not ended (any day); `today` = calls started since midnight. */
export function summarize(live: CallStatRow[], today: CallStatRow[], now: number): LiveStats {
  const onCalls = live
    .filter((c) => c.state === "answered")
    .map((c) => ({ callId: c.id, agent: c.agent_email, direction: c.direction, sinceSeconds: secs(c.answered_at ?? c.started_at, now) }))
    .sort((a, b) => b.sinceSeconds - a.sinceSeconds);
  const waiting = live
    .filter((c): c is CallStatRow & { state: "menu" | "ringing" | "parked" } => c.direction === "incoming" && ["menu", "ringing", "parked"].includes(c.state))
    .map((c) => ({ callId: c.id, state: c.state, waitingSeconds: secs(c.started_at, now) }))
    .sort((a, b) => b.waitingSeconds - a.waitingSeconds);

  const incoming = today.filter((c) => c.direction === "incoming");
  const answered = incoming.filter((c) => c.answered_at);
  const waits = answered.map((c) => Math.max(0, (Date.parse(c.answered_at!) - Date.parse(c.started_at)) / 1000));
  const decided = incoming.filter((c) => c.answered_at || c.state === "ended");
  return {
    now: new Date(now).toISOString(),
    onCalls,
    waiting,
    today: {
      incoming: incoming.length,
      answered: answered.length,
      missed: incoming.filter((c) => c.result === "missed").length,
      voicemail: incoming.filter((c) => c.result === "voicemail").length,
      outgoing: today.length - incoming.length,
      averageAnswerSeconds: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
      longestAnswerSeconds: waits.length ? Math.round(Math.max(...waits)) : null,
      answerRate: decided.length ? Math.round((answered.length / decided.length) * 100) : null,
    },
  };
}
