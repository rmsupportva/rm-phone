/**
 * Text messaging rules: conversations, unread counts, message length and
 * opt-out keywords. Pure functions; the engine applies them.
 */
import { digitsOf } from "./contacts";
import type { Message } from "./types";

export interface Conversation {
  number: string;
  last: Message;
  unread: number;
  optedOut: boolean;
}

/** One entry per other party, newest activity first. */
export function listConversations(
  messages: Message[],
  reads: Record<string, number>,
  optOuts: string[],
): Conversation[] {
  const byNumber = new Map<string, Message[]>();
  for (const m of messages) byNumber.set(m.number, [...(byNumber.get(m.number) ?? []), m]);
  const out: Conversation[] = [];
  for (const [number, list] of byNumber) {
    const sorted = list.sort((a, b) => a.at - b.at);
    const readAt = reads[number] ?? 0;
    out.push({
      number,
      last: sorted[sorted.length - 1],
      unread: sorted.filter((m) => m.direction === "inbound" && m.at > readAt).length,
      optedOut: optOuts.includes(number),
    });
  }
  return out.sort((a, b) => b.last.at - a.last.at);
}

export function threadFor(messages: Message[], number: string): Message[] {
  const key = digitsOf(number);
  return messages.filter((m) => digitsOf(m.number) === key).sort((a, b) => a.at - b.at);
}

/* ---------- Length ---------- */

// The GSM 03.38 basic character set. Anything outside it (emoji, curly quotes,
// most accents) switches the whole message to UCS-2, which fits far fewer
// characters per text.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€";

export interface SmsLength {
  characters: number;
  segments: number;
  encoding: "GSM-7" | "UCS-2";
  /** Characters left before another segment is needed. */
  remaining: number;
}

export function smsLength(body: string): SmsLength {
  let gsmUnits = 0;
  let gsm = true;
  for (const ch of body) {
    if (GSM_BASIC.includes(ch)) gsmUnits += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmUnits += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (gsm) {
    const segments = gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153);
    const capacity = segments === 1 ? 160 : segments * 153;
    return { characters: gsmUnits, segments: Math.max(1, segments), encoding: "GSM-7", remaining: capacity - gsmUnits };
  }
  const units = [...body].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  const capacity = segments === 1 ? 70 : segments * 67;
  return { characters: units, segments: Math.max(1, segments), encoding: "UCS-2", remaining: capacity - units };
}

export const MAX_MESSAGE_CHARACTERS = 1600;

/* ---------- Opt-out (carrier rules: STOP must always work) ---------- */

const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const START_WORDS = ["START", "UNSTOP"];

export type Keyword = "stop" | "start" | null;

/** A message that is exactly one opt-out / opt-in keyword (any case, spaces and trailing punctuation ignored). */
export function keywordOf(body: string): Keyword {
  const word = body.trim().replace(/[.!]+$/, "").toUpperCase();
  if (STOP_WORDS.includes(word)) return "stop";
  if (START_WORDS.includes(word)) return "start";
  return null;
}

export const AUTO_REPLY = {
  stop: "RM Support: You're unsubscribed and won't get more texts from this number. Reply START to resubscribe.",
  start: "RM Support: You're subscribed again. Reply STOP to unsubscribe.",
} as const;

export type SendCheck = { ok: true; body: string } | { ok: false; reason: string };

export function checkOutgoing(body: string, to: string, optOuts: string[]): SendCheck {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, reason: "Type a message first." };
  if ([...trimmed].length > MAX_MESSAGE_CHARACTERS) {
    return { ok: false, reason: `Messages can be up to ${MAX_MESSAGE_CHARACTERS} characters.` };
  }
  if (optOuts.some((n) => digitsOf(n) === digitsOf(to))) {
    return { ok: false, reason: "This number replied STOP. They can't be texted until they reply START." };
  }
  return { ok: true, body: trimmed };
}
