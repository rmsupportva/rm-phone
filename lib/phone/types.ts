/**
 * Core types for the RM phone system.
 *
 * Everything in lib/phone is plain TypeScript with no React, no Next and no
 * vendor SDK, so it can move into CareHub (or a server) unchanged.
 */

export type Lang = "en" | "es";

export type Presence = "available" | "busy" | "wrap_up" | "away" | "offline";

export interface Agent {
  id: string;
  name: string;
  presence: Presence;
  speaksSpanish: boolean;
  queueIds: string[];
}

export interface Contact {
  id: string;
  name: string;
  numbers: { label: string; e164: string }[];
  notes?: string;
  createdAt: number;
}

export type MessageStatus = "sending" | "delivered" | "failed" | "received";

export interface Message {
  id: string;
  /** The other party's number: the conversation this message belongs to. */
  number: string;
  direction: "inbound" | "outbound";
  body: string;
  at: number;
  status: MessageStatus;
  /** Who sent it (outbound). Absent on automatic replies. */
  agentId?: string;
  /** Sent by the system itself (e.g. the STOP confirmation). */
  automatic?: boolean;
  error?: string;
}

export type CallDirection = "inbound" | "outbound";

/**
 * Where a call is right now. Every state except `ended` carries a deadline
 * (see `Call.deadline`), so no call can stay open forever.
 */
export type CallState =
  | "menu" // caller is in the phone menu
  | "ringing" // agents' phones are ringing
  | "voicemail" // caller hears the greeting / is recording
  | "dialing" // outbound: waiting for the other side to pick up
  | "answered" // two people are talking
  | "ended";

export type MenuStep = "language" | "main";

export type EndReason =
  | "completed" // a conversation happened
  | "voicemail" // caller left a message
  | "missed" // nobody answered and no message was left
  | "abandoned_menu" // caller hung up inside the menu
  | "no_answer" // outbound: the other side never picked up
  | "cancelled" // outbound: the agent hung up before an answer
  | "failed" // the carrier could not place the call
  | "timed_out"; // safety cap reached

export type TimerKind = "menu" | "ring" | "voicemail" | "dial" | "max_call";

export type HoursState = "open" | "closed" | "holiday" | "early_close";

export interface TranscriptTurn {
  atSecond: number;
  speaker: "agent" | "caller";
  text: string;
}

export interface Recording {
  id: string;
  seconds: number;
}

export interface TimelineEntry {
  at: number;
  kind: string;
  detail?: string;
}

export interface Call {
  id: string;
  direction: CallDirection;
  /** Caller for inbound, our number for outbound. */
  from: string;
  /** Our number for inbound, the dialed number for outbound. */
  to: string;
  state: CallState;
  lang: Lang;
  startedAt: number;
  answeredAt?: number;
  endedAt?: number;
  endReason?: EndReason;
  /** Inbound only: the hours decision made when the call arrived. */
  hoursState?: HoursState;
  menuStep?: MenuStep;
  queueId?: string;
  ringingAgentIds: string[];
  declinedAgentIds: string[];
  /** Who answered (inbound) or who dialed (outbound). */
  agentId?: string;
  deadline?: { kind: TimerKind; at: number };
  voicemail?: Recording;
  /** When someone first opened the voicemail. Unheard voicemails are highlighted. */
  heardAt?: number;
  recording?: Recording;
  transcript?: TranscriptTurn[];
  /** Talk time in whole seconds, set when an answered call ends. */
  talkSeconds?: number;
  timeline: TimelineEntry[];
}

/** Something that happened to a call, from the carrier, an agent or a timer. */
export type CallInput =
  | { type: "caller_pressed"; digit: string }
  | { type: "agent_answered"; agentId: string }
  | { type: "agent_declined"; agentId: string }
  | { type: "agent_unavailable"; agentId: string }
  | { type: "caller_hung_up" }
  | { type: "agent_hung_up"; agentId: string }
  | { type: "voicemail_saved"; recording: Recording; transcript?: TranscriptTurn[] }
  | { type: "far_end_answered" }
  | { type: "far_end_failed" }
  | { type: "recording_ready"; recording: Recording; transcript: TranscriptTurn[] }
  | { type: "timer"; kind: TimerKind };

export type PromptId =
  | "welcome_language"
  | "main_menu"
  | "closed"
  | "holiday"
  | "early_close"
  | "all_busy"
  | "voicemail_greeting"
  | "please_hold";

/** What the machine asks the outside world (the carrier, the app) to do. */
export type Effect =
  | { type: "play"; prompt: PromptId; lang: Lang }
  | { type: "ring"; agentIds: string[] }
  | { type: "stop_ringing"; agentIds: string[] }
  | { type: "record_voicemail"; maxSeconds: number }
  | { type: "connect"; agentId: string }
  | { type: "dial"; to: string }
  | { type: "hang_up_caller" }
  | { type: "hang_up_agent"; agentId: string }
  | { type: "set_presence"; agentId: string; presence: Presence };
