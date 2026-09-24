import type { CallInput, Effect } from "./types";

/**
 * The phone company, seen from our side.
 *
 * The call brain never names a vendor. Any carrier (the mock today,
 * SignalWire later) plugs in by implementing these two things:
 *   - `perform`: carry out an effect (ring, play, record, connect, hang up…)
 *   - `subscribe`: report what happened on the line (a new call, a key
 *     press, a hang-up, a saved voicemail, a finished recording…)
 */
export type ProviderEvent =
  | { type: "incoming_call"; callId: string; from: string }
  | { type: "call_input"; callId: string; input: CallInput };

export interface PhoneProvider {
  readonly name: string;
  perform(callId: string, effect: Effect): void;
  subscribe(handler: (event: ProviderEvent) => void): () => void;
}

/** Text messages, the same way: send out, and hear back about delivery and new texts. */
export type MessagingEvent =
  | { type: "message_received"; id: string; from: string; body: string }
  | { type: "message_status"; id: string; status: "delivered" | "failed"; error?: string };

export interface MessagingProvider {
  sendMessage(message: { id: string; to: string; from: string; body: string }): void;
  subscribeMessages(handler: (event: MessagingEvent) => void): () => void;
}
