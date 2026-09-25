/**
 * The settings people can change on screen (old phone: workspace_phone_settings,
 * queues, business_hours, ivr_flows), stored as ONE saved record on top of the
 * built-in defaults.
 *
 * `checkSaved` is the only way in: anything unknown, out of range or unsafe is
 * refused with plain-words problems, so a bad save can never reach a caller.
 * `withSaved` lays a checked record over the defaults.
 */
import { validateFlow, type IvrFlow } from "./ivr";
import { PROMPTS, type HoursSettings, type PhoneSettings, type RingStrategy } from "./settings";
import type { Lang, PromptId } from "./types";

export interface SavedSettings {
  hours?: Partial<Pick<HoursSettings, "weekly" | "holidays" | "earlyCloses">>;
  routing?: PhoneSettings["routing"];
  ivr?: IvrFlow | null;
  afterHours?: { action: "voicemail" | "hangup" | "queue" };
  queue?: { ringSeconds?: number; strategy?: RingStrategy; overflow?: "voicemail" | "hangup"; callbackOffer?: boolean };
  menuSeconds?: number;
  voicemailMaxSeconds?: number;
  dialSeconds?: number;
  recording?: { mode: "off" | "all"; announce: boolean } | null;
  postCallFeedback?: boolean;
  missedCallbacks?: boolean;
  returningCallers?: { withinDays: number } | null;
  prompts?: Partial<Record<PromptId, Record<Lang, string>>>;
}

/** The limits, shared with the settings screen so it can say them up front. */
export const LIMITS = {
  ringSeconds: [5, 120],
  menuSeconds: [2, 30],
  voicemailMaxSeconds: [10, 300],
  dialSeconds: [10, 120],
  withinDays: [1, 365],
  promptLength: 600,
  holidays: 200,
  earlyCloses: 200,
} as const;

const TOP_KEYS = new Set<keyof SavedSettings>([
  "hours", "routing", "ivr", "afterHours", "queue", "menuSeconds", "voicemailMaxSeconds", "dialSeconds",
  "recording", "postCallFeedback", "missedCallbacks", "returningCallers", "prompts",
]);
const STRATEGIES = new Set<RingStrategy>(["ring_all", "linear", "round_robin", "longest_idle"]);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

export function checkSaved(raw: unknown): { ok: true; saved: SavedSettings } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!isObj(raw)) return { ok: false, problems: ["Settings must be an object."] };
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k as keyof SavedSettings)) problems.push(`Unknown setting "${k}".`);
  const s = raw as SavedSettings;

  const whole = (v: unknown, [lo, hi]: readonly [number, number], what: string) => {
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) problems.push(`${what} must be a whole number from ${lo} to ${hi}.`);
  };
  const flag = (v: unknown, what: string) => {
    if (v !== undefined && typeof v !== "boolean") problems.push(`${what} must be on or off.`);
  };

  if (s.hours !== undefined) checkHours(s.hours, problems);
  if (s.routing !== undefined && !["ivr", "queue", "voicemail", "hangup"].includes(s.routing as string)) problems.push("What the number does must be menu, queue, voicemail or hang up.");
  if (s.ivr !== undefined && s.ivr !== null) {
    if (!isObj(s.ivr) || typeof s.ivr.rootId !== "string" || !Array.isArray(s.ivr.nodes)) problems.push("The phone menu is not in the right shape.");
    else if (s.ivr.nodes.length > 100) problems.push("The phone menu can have at most 100 steps.");
    else {
      problems.push(...validateFlow(s.ivr).map((p) => `Phone menu: ${p}`));
      // Only US numbers: a menu must not be able to forward callers abroad (toll fraud).
      for (const n of s.ivr.nodes) {
        if (n.type === "dial" && n.to?.kind === "external" && !/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(n.to.number)) {
          problems.push(`Phone menu: "${n.id}" must dial a US number like +17185550100.`);
        }
      }
    }
  }
  if (s.afterHours !== undefined && !(isObj(s.afterHours) && ["voicemail", "hangup", "queue"].includes(s.afterHours.action as string))) {
    problems.push("After hours must be voicemail, hang up or queue.");
  }
  if (s.queue !== undefined) {
    if (!isObj(s.queue)) problems.push("Ringing settings are not in the right shape.");
    else {
      for (const k of Object.keys(s.queue)) if (!["ringSeconds", "strategy", "overflow", "callbackOffer"].includes(k)) problems.push(`Unknown ringing setting "${k}".`);
      whole(s.queue.ringSeconds, LIMITS.ringSeconds, "Ring time");
      if (s.queue.strategy !== undefined && !STRATEGIES.has(s.queue.strategy)) problems.push("How it rings must be all at once, in order, taking turns or longest free.");
      if (s.queue.overflow !== undefined && !["voicemail", "hangup"].includes(s.queue.overflow)) problems.push("When nobody answers must be voicemail or hang up.");
      flag(s.queue.callbackOffer, "The callback offer");
    }
  }
  whole(s.menuSeconds, LIMITS.menuSeconds, "Menu wait");
  whole(s.voicemailMaxSeconds, LIMITS.voicemailMaxSeconds, "Longest voicemail");
  whole(s.dialSeconds, LIMITS.dialSeconds, "Outgoing ring time");
  if (s.recording !== undefined && s.recording !== null && !(isObj(s.recording) && ["off", "all"].includes(s.recording.mode) && typeof s.recording.announce === "boolean")) {
    problems.push("Recording must be off or all calls, with the notice on or off.");
  }
  flag(s.postCallFeedback, "The after-call rating text");
  flag(s.missedCallbacks, "Missed calls to the callback list");
  if (s.returningCallers !== undefined && s.returningCallers !== null) {
    if (!isObj(s.returningCallers)) problems.push("Returning callers is not in the right shape.");
    else whole(s.returningCallers.withinDays, LIMITS.withinDays, "Returning callers: days");
  }
  if (s.prompts !== undefined) {
    if (!isObj(s.prompts)) problems.push("Messages are not in the right shape.");
    else
      for (const [id, text] of Object.entries(s.prompts)) {
        if (!(id in PROMPTS)) problems.push(`Unknown message "${id}".`);
        else if (!isObj(text) || typeof text.en !== "string" || typeof text.es !== "string") problems.push(`Message "${id}" needs English and Spanish.`);
        else if (!text.en.trim() || !text.es.trim()) problems.push(`Message "${id}" can't be empty.`);
        else if (text.en.length > LIMITS.promptLength || text.es.length > LIMITS.promptLength) problems.push(`Message "${id}" is longer than ${LIMITS.promptLength} characters.`);
      }
  }
  return problems.length ? { ok: false, problems } : { ok: true, saved: s };
}

function checkHours(h: unknown, problems: string[]) {
  if (!isObj(h)) return void problems.push("Office hours are not in the right shape.");
  const { weekly, holidays, earlyCloses } = h as Partial<HoursSettings>;
  if (weekly !== undefined) {
    if (!Array.isArray(weekly) || weekly.length !== 7) problems.push("Office hours need all 7 days.");
    else
      weekly.forEach((d, i) => {
        if (d === null) return;
        if (!isObj(d) || !TIME.test(String(d.open)) || !TIME.test(String(d.close))) problems.push(`Day ${i}: times must look like 09:00.`);
        else if (minutes(d.open) >= minutes(d.close)) problems.push(`Day ${i}: closing must be after opening.`);
      });
  }
  if (holidays !== undefined) {
    if (!Array.isArray(holidays) || holidays.length > LIMITS.holidays) problems.push(`Holidays: a list of at most ${LIMITS.holidays}.`);
    else for (const x of holidays) if (!isObj(x) || !DATE.test(String(x.date)) || typeof x.name !== "string" || x.name.length > 80) problems.push("Each holiday needs a date (2026-12-25) and a short name.");
  }
  if (earlyCloses !== undefined) {
    if (!Array.isArray(earlyCloses) || earlyCloses.length > LIMITS.earlyCloses) problems.push(`Early closes: a list of at most ${LIMITS.earlyCloses}.`);
    else
      for (const x of earlyCloses)
        if (!isObj(x) || !DATE.test(String(x.date)) || !TIME.test(String(x.closeAt)) || typeof x.reason !== "string" || x.reason.length > 80) {
          problems.push("Each early close needs a date, a time (16:30) and a short reason.");
        }
  }
}

/** The defaults with a checked saved record on top. */
export function withSaved(base: PhoneSettings, saved: SavedSettings): PhoneSettings {
  const out: PhoneSettings = { ...base, hours: { ...base.hours, ...saved.hours }, queue: { ...base.queue } };
  if (saved.routing !== undefined) out.routing = saved.routing;
  if (saved.ivr !== undefined) {
    if (saved.ivr) out.ivr = saved.ivr;
    else delete out.ivr;
  }
  if (saved.afterHours) out.afterHours = { action: saved.afterHours.action, ...(saved.afterHours.action === "queue" && { queueId: base.queue.id }) };
  if (saved.queue) {
    const q = saved.queue;
    if (q.ringSeconds !== undefined) out.queue.ringSeconds = q.ringSeconds;
    if (q.strategy !== undefined) out.queue.strategy = q.strategy;
    if (q.overflow !== undefined) out.queue.overflow = { action: q.overflow };
    if (q.callbackOffer !== undefined) out.queue.callbackOffer = q.callbackOffer;
  }
  if (saved.menuSeconds !== undefined) out.menuSeconds = saved.menuSeconds;
  if (saved.voicemailMaxSeconds !== undefined) out.voicemailMaxSeconds = saved.voicemailMaxSeconds;
  if (saved.dialSeconds !== undefined) out.dialSeconds = saved.dialSeconds;
  if (saved.recording !== undefined) {
    if (saved.recording) out.recording = saved.recording;
    else delete out.recording;
  }
  if (saved.postCallFeedback !== undefined) out.postCallFeedback = saved.postCallFeedback;
  if (saved.missedCallbacks !== undefined) out.missedCallbacks = saved.missedCallbacks;
  if (saved.returningCallers !== undefined) {
    if (saved.returningCallers) out.returningCallers = saved.returningCallers;
    else delete out.returningCallers;
  }
  if (saved.prompts) out.prompts = { ...base.prompts, ...saved.prompts };
  return out;
}
