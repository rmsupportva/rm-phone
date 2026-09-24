import { END_REASON_LABEL } from "@/lib/phone/callMachine";
import type { Call, CallState, Presence } from "@/lib/phone/types";

export const TIMEZONE = "America/New_York";

/** "+18455550111" → "(845) 555-0111" */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Accepts what people type ("845 555 0111", "(845)555-0111", "+1…") and returns E.164, or null. */
export function parsePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** The outside party: the caller on inbound, the dialed number on outbound. */
export function otherParty(call: Call): string {
  return call.direction === "inbound" ? call.from : call.to;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatTime = (ms: number) => timeFmt.format(ms);
export const formatDateTime = (ms: number) => dateTimeFmt.format(ms);

const shortTimeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" });
const monthDayFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, month: "short", day: "numeric" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** List-style time, like a phone: "2:14 PM" today, "Yesterday", "Mon" this week, then "Sep 3". */
export function formatListTime(ms: number, now: number): string {
  const day = (t: number) => Date.parse(`${dayKeyFmt.format(t)}T00:00:00Z`) / 86_400_000;
  const diff = day(now) - day(ms);
  if (diff <= 0) return shortTimeFmt.format(ms);
  if (diff === 1) return "Yesterday";
  if (diff < 7) return weekdayFmt.format(ms);
  return monthDayFmt.format(ms);
}

export const formatShortTime = (ms: number) => shortTimeFmt.format(ms);

const dayHeadingFmt = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "long", month: "short", day: "numeric" });
export const formatDayHeading = (ms: number) => dayHeadingFmt.format(ms);
/** Same calendar day in the office time zone. */
export const sameDay = (a: number, b: number) => dayKeyFmt.format(a) === dayKeyFmt.format(b);

/** "Ana Morales" → "AM", "(845) 555-0111" → "#". */
export function initialsOf(name: string): string {
  if (!/[a-zA-ZÀ-ÿ]/.test(name)) return "#";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export type Tone = "success" | "caution" | "danger" | "info" | "neutral";

export interface StatusView {
  label: string;
  tone: Tone;
  icon: IconName;
}

export type IconName =
  | "incoming"
  | "outgoing"
  | "missed"
  | "voicemail"
  | "check"
  | "x"
  | "menu"
  | "bell"
  | "talk"
  | "clock"
  | "phone"
  | "pause"
  | "moon"
  | "message"
  | "contacts"
  | "team"
  | "settings"
  | "search"
  | "plus"
  | "back"
  | "send"
  | "alert";

const LIVE_STATE: Record<Exclude<CallState, "ended">, StatusView> = {
  menu: { label: "In menu", tone: "info", icon: "menu" },
  ringing: { label: "Ringing", tone: "caution", icon: "bell" },
  voicemail: { label: "Voicemail", tone: "info", icon: "voicemail" },
  dialing: { label: "Dialing", tone: "caution", icon: "outgoing" },
  answered: { label: "Talking", tone: "success", icon: "talk" },
  parked: { label: "Parked", tone: "info", icon: "pause" },
};

export function callStatus(call: Call): StatusView {
  if (call.state === "answered" && call.onHold) return { label: "On hold", tone: "info", icon: "pause" };
  if (call.state === "ringing" && call.answeredAt !== undefined) return { label: "On hold, ringing team", tone: "caution", icon: "bell" };
  if (call.state !== "ended") return LIVE_STATE[call.state];
  const label = END_REASON_LABEL[call.endReason ?? "missed"];
  switch (call.endReason) {
    case "completed":
      return { label, tone: "success", icon: "check" };
    case "voicemail":
      return { label, tone: "caution", icon: "voicemail" };
    case "missed":
    case "abandoned_menu":
      return { label, tone: "danger", icon: "missed" };
    case "timed_out":
    case "failed":
      return { label, tone: "danger", icon: "x" };
    case "transferred":
      return { label, tone: "info", icon: "outgoing" };
    default:
      return { label, tone: "neutral", icon: "x" };
  }
}

export const PRESENCE_VIEW: Record<Presence, StatusView> = {
  available: { label: "Available", tone: "success", icon: "check" },
  busy: { label: "On a call", tone: "caution", icon: "talk" },
  wrap_up: { label: "Wrap-up", tone: "info", icon: "clock" },
  away: { label: "Away", tone: "neutral", icon: "pause" },
  offline: { label: "Offline", tone: "neutral", icon: "moon" },
};

export const TIMELINE_LABEL: Record<string, string> = {
  received: "Call came in",
  hours_checked: "Hours check",
  menu: "Menu",
  menu_invalid_key: "Wrong key pressed",
  language: "Language",
  menu_choice: "Menu choice",
  ringing: "Ringing",
  declined: "Declined",
  agent_left: "Left",
  nobody_left_ringing: "Everyone declined",
  nobody_available: "Nobody available",
  ring_no_answer: "No answer",
  voicemail: "Sent to voicemail",
  voicemail_saved: "Message saved",
  voicemail_empty: "Empty message",
  voicemail_timeout: "Voicemail closed",
  answered: "Answered",
  hung_up: "Hung up",
  dialing: "Dialing",
  no_answer: "No answer",
  failed: "Failed",
  safety_cap: "Safety cap",
  ended: "Ended",
  recording_saved: "Recording saved",
  hold: "On hold",
  resumed: "Off hold",
  parked: "Parked",
  picked_up: "Picked up",
  park_timeout: "Parked too long",
  transfer_started: "Transfer",
  transfer_answered: "Transfer answered",
  transfer_failed: "Transfer didn't go through",
  transfer_cancelled: "Transfer cancelled",
  transferred: "Transferred to",
  inviting: "Asked to join",
  invite_failed: "Couldn't add anyone",
  invite_cancelled: "Stopped asking",
  invite_no_answer: "Nobody joined",
  joined: "Joined the call",
  left: "Left the call",
};
