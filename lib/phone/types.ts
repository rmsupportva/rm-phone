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
  /** Ring the agent's own phone too (old phone: user_phone_prefs forward_*). */
  forward?: AgentForward;
  /** Ring order within a queue: lower rings first (old phone: queue_members.priority). */
  priority?: number;
  /** When they last became free, for "longest idle" ringing (ms). */
  idleSince?: number;
}

/**
 * Forwarding to an agent's own phone, exactly as the old phone did it:
 *  - parallel: browser and own phone ring together for the whole ring;
 *  - afterSec 0: only the own phone rings;
 *  - afterSec >= the ring window: only the browser rings;
 *  - otherwise: the browser rings first and the own phone joins after afterSec.
 */
export interface AgentForward {
  to: string;
  afterSec: number;
  parallel: boolean;
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
  | "parked" // caller on hold with no agent; anyone can pick them up
  | "ended";

/** "callback_offer": nobody is free and the line offers "press 1 for a callback". */
export type MenuStep = "language" | "main" | "callback_offer";

export type EndReason =
  | "completed" // a conversation happened
  | "voicemail" // caller left a message
  | "missed" // nobody answered and no message was left
  | "abandoned_menu" // caller hung up inside the menu
  | "no_answer" // outbound: the other side never picked up
  | "cancelled" // outbound: the agent hung up before an answer
  | "failed" // the carrier could not place the call
  | "timed_out" // safety cap reached
  | "transferred"; // handed to an outside number; we are no longer on it

export type TimerKind =
  | "menu"
  | "ring"
  | "voicemail"
  | "dial"
  | "max_call"
  | "transfer" // a transfer target is ringing
  | "invite" // someone is being added to the call (e.g. a VA to translate)
  | "park"; // a parked call waits this long before the team is rung

/** Where a transfer goes. */
export type TransferTarget =
  | { kind: "agent"; agentId: string }
  | { kind: "queue" } // everyone available on the line
  | { kind: "external"; to: string };

export interface TransferState {
  /** blind: hand over as soon as the target answers. warm: talk to them first. */
  mode: "blind" | "warm";
  target: TransferTarget;
  phase: "ringing" | "consulting";
  /** The agent who started the transfer. Absent once they have left the call. */
  byAgentId?: string;
  ringingAgentIds: string[];
  /** Who answered the transfer (an agent id, or "external"). */
  answeredBy?: string;
  startedAt: number;
}

export interface InviteState {
  byAgentId: string;
  ringingAgentIds: string[];
  startedAt: number;
  /** Call VA: who rings next if nobody in the first round answers. */
  nextRound?: string[];
}

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
  /** When the current ring runs out (forwards can fall due before that). */
  ringEndsAt?: number;
  /** One-at-a-time ringing: who rings, in order, and who is next. */
  ringPlan?: { queueId: string; order: string[]; next: number };
  /**
   * Who should ring first if they are free: the number's own agent, or the
   * agent this caller last spoke with (decided by the webhook, see startInbound).
   */
  preferredAgentId?: string;
  /** Already overflowed to another queue once (never chains further). */
  overflowed?: boolean;
  /** Own-phone forwards that fall due during the current ring. */
  pendingForwards?: { agentId: string; to: string; at: number }[];
  /** Who answered (inbound) or who dialed (outbound). */
  agentId?: string;
  /**
   * Outbound from the agent's own cell: "agent" while their cell rings,
   * "family" once they answered and the other side is being dialled.
   */
  dialPhase?: "agent" | "family";
  deadline?: { kind: TimerKind; at: number };
  voicemail?: Recording;
  /** When someone first opened the voicemail. Unheard voicemails are highlighted. */
  heardAt?: number;
  recording?: Recording;
  transcript?: TranscriptTurn[];
  /** Talk time in whole seconds, set when an answered call ends. */
  talkSeconds?: number;
  /** The caller hears hold music. */
  onHold?: boolean;
  transfer?: TransferState;
  /** Others on the call besides the handling agent (e.g. a VA translating). */
  participants?: string[];
  inviting?: InviteState;
  /** Who parked the call, and when (state "parked"). */
  parkedBy?: string;
  parkedAt?: number;
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
  | { type: "timer"; kind: TimerKind }
  // In-call actions by an agent:
  | { type: "hold"; agentId: string }
  | { type: "resume"; agentId: string }
  | { type: "park"; agentId: string }
  | { type: "unpark"; agentId: string }
  | { type: "transfer"; agentId: string; mode: "blind" | "warm"; target: TransferTarget }
  | { type: "transfer_complete"; agentId: string }
  | { type: "transfer_cancel"; agentId: string }
  /**
   * Add someone to the call. With `thenTargets` it is the old phone's Call VA:
   * `targets` (the agent's own VA) ring first for inviteFirstSeconds, then
   * everyone available in `thenTargets` rings at once for inviteSeconds.
   */
  | { type: "invite"; agentId: string; targets: string[]; thenTargets?: string[] }
  | { type: "invite_cancel"; agentId: string }
  | { type: "participant_left"; agentId: string }
  // The external party of a transfer, from the carrier:
  | { type: "external_answered" }
  | { type: "external_failed" }
  | { type: "external_hung_up" };

export type PromptId =
  | "welcome_language"
  | "main_menu"
  | "closed"
  | "holiday"
  | "early_close"
  | "all_busy"
  | "voicemail_greeting"
  | "please_hold"
  | "callback_offer"
  | "callback_confirmed"
  | "no_agents";

/** What the machine asks the outside world (the carrier, the app) to do. */
export type Effect =
  | { type: "play"; prompt: PromptId; lang: Lang }
  | { type: "ring"; agentIds: string[] }
  /** Ring an agent on their own phone (forwarding). Answer / decline report as that agent. */
  | { type: "ring_external_for_agent"; agentId: string; to: string }
  /** Stop ringing these agents: their browser AND any own-phone forward. */
  | { type: "stop_ringing"; agentIds: string[] }
  | { type: "record_voicemail"; maxSeconds: number }
  | { type: "connect"; agentId: string }
  | { type: "dial"; to: string }
  /** Outbound from the agent's own phone: ring it first (they hear ringback once they answer). */
  | { type: "dial_agent_cell"; agentId: string; to: string }
  | { type: "hang_up_caller" }
  | { type: "hang_up_agent"; agentId: string }
  | { type: "set_presence"; agentId: string; presence: Presence }
  /** Round robin: the queue's starting point moves on by one (old phone: bump_queue_round_robin). */
  | { type: "advance_rotation"; queueId: string; memberCount: number }
  /** Save a callback request for the team (old phone: callbacks row, due now, unassigned). */
  | { type: "create_callback"; source: "caller_requested" | "menu"; from: string; lang: Lang }
  | { type: "hold_caller" }
  | { type: "unhold_caller" }
  /** Put another agent into the live call (transfer target, VA). */
  | { type: "add_to_call"; agentId: string }
  /** Take an agent out of a call that carries on without them. */
  | { type: "remove_from_call"; agentId: string }
  | { type: "dial_external"; to: string }
  | { type: "hang_up_external" }
  /** Leave the caller and the external party talking; we are no longer on the call. */
  | { type: "release_to_external" };
