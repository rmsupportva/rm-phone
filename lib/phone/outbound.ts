/**
 * Outbound rules from the old phone (rm-telephony control.ts /
 * outboundCallerId.ts), as pure functions the server calls before dialling.
 */
import { digitsOf } from "./contacts";

export interface VoiceNumber {
  e164: string;
  active: boolean;
  /** The carrier's id for the number; unset = never provisioned (a placeholder). */
  providerRef?: string | null;
  queueId?: string | null;
  /** The line-wide default caller id (old: phone_numbers.is_default_outbound_caller_id). */
  isDefaultOutbound?: boolean;
}

/**
 * The number an agent calls FROM. Old order: only active numbers; prefer ones
 * actually provisioned at the carrier; then one attached to a queue the agent
 * is in; otherwise the lowest number. None → the call must be refused (H12).
 */
export function chooseCallingNumber(numbers: VoiceNumber[], agentQueueIds: string[]): VoiceNumber | null {
  const active = numbers.filter((n) => n.active);
  const provisioned = active.filter((n) => n.providerRef);
  const pool = provisioned.length ? provisioned : active;
  if (!pool.length) return null;
  const mine = pool.filter((n) => n.queueId && agentQueueIds.includes(n.queueId));
  const pick = (list: VoiceNumber[]) => [...list].sort((a, b) => (a.e164 < b.e164 ? -1 : a.e164 > b.e164 ? 1 : 0))[0];
  return pick(mine.length ? mine : pool);
}

/**
 * The caller id the other side sees. Old order: the line's default outbound
 * number (if active) → a verified outside default (e.g. a staff member's
 * verified cell) → the number we call from.
 */
export function chooseCallerId(numbers: VoiceNumber[], callingNumber: VoiceNumber, verifiedExternalDefault?: string | null): string {
  const lineDefault = numbers.find((n) => n.active && n.isDefaultOutbound);
  return lineDefault?.e164 ?? verifiedExternalDefault ?? callingNumber.e164;
}

/** Do Not Call: matched on the last 10 digits, like the old is_dnc(). */
export function isOnDoNotCall(list: string[], e164: string): boolean {
  const key = digitsOf(e164).slice(-10);
  return list.some((n) => digitsOf(n).slice(-10) === key);
}

export type DncCheck = { ok: true } | { ok: false; reason: string };

/**
 * The old phone's Do Not Call gate. A number on the list is refused with a
 * reason. If the list can't be read the call still goes ahead (the old phone
 * did the same) — the caller of this function must report that failure.
 */
export function doNotCallGate(e164: string, list: string[] | null): DncCheck {
  if (list === null) return { ok: true };
  if (isOnDoNotCall(list, e164)) return { ok: false, reason: "That number is on the Do Not Call list, so the call was not placed." };
  return { ok: true };
}
