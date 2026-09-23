import { END_REASON_LABEL } from "@/lib/phone/callMachine";
import { DEMO_CALLERS } from "@/lib/phone/mock/fakeData";
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

export function callerLabel(e164: string): string | undefined {
  return DEMO_CALLERS.find((c) => c.number === e164)?.label;
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
  | "moon";

const LIVE_STATE: Record<Exclude<CallState, "ended">, StatusView> = {
  menu: { label: "In menu", tone: "info", icon: "menu" },
  ringing: { label: "Ringing", tone: "caution", icon: "bell" },
  voicemail: { label: "Voicemail", tone: "info", icon: "voicemail" },
  dialing: { label: "Dialing", tone: "caution", icon: "outgoing" },
  answered: { label: "Talking", tone: "success", icon: "talk" },
};

export function callStatus(call: Call): StatusView {
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
  agent_left: "Stopped ringing (stepped away)",
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
};
