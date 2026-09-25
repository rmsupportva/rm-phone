/**
 * What an inbound CALLER hears and does right now, carrier-neutral.
 *
 * The call brain decides; this turns its decision into a short script the
 * carrier adapter renders (as cXML / SWML) and returns to the phone company
 * from a webhook: say this, then wait for keys; say this, then record; wait in
 * the call's room; hang up.
 *
 * `scriptFor(call, effects)` works from the call's CURRENT STATE, so any
 * webhook can ask for it again (e.g. a retried request) and get the same
 * answer. `effects` only adds the one-off prompts this step produced (such as
 * "we're closed" before the voicemail greeting).
 */
import type { PromptRef } from "./ivr";
import { PROMPTS, type PhoneSettings } from "./settings";
import type { Call, Effect, Lang } from "./types";

export type CallerStep =
  /** Speak text in the caller's language. */
  | { kind: "say"; text: string; lang: Lang; voiceLang: "en-US" | "es-US" }
  /** Play a recorded message (a menu can use its own recordings). */
  | { kind: "play_audio"; url: string }
  /**
   * Wait for up to `maxDigits` keys (# finishes early), or spoken words when
   * `speechHints` is set. Keys go back as `caller_pressed`, words as
   * `caller_spoke`. With nothing, the adapter feeds `{ type: "timer", kind:
   * "menu" }`: `timeoutSec` is a second past the menu's deadline, so it's due.
   */
  | { kind: "gather"; timeoutSec: number; maxDigits: number; finishOnKey: "#"; speechHints?: string[] }
  /** Record a message after a beep; the result goes back as `voicemail_saved`. */
  | { kind: "record"; maxSeconds: number; beep: true; finishOnKey: "#"; silenceTimeoutSec: number }
  /** Wait alone in the call's room with hold music until someone joins. */
  | { kind: "hold"; room: string }
  /** Talk in the call's room (someone is there). */
  | { kind: "bridge"; room: string }
  | { kind: "hangup" };

/** The conference room every leg of this call joins. */
export const roomFor = (call: Pick<Call, "id">) => `rm-${call.id}`;

/** Seconds of silence after which a recording stops by itself. */
export const RECORD_SILENCE_SECONDS = 7;

/** Edited wording for built-in messages (settings.prompts). */
export type PromptOverrides = PhoneSettings["prompts"];

/** Turn a message reference into what the caller hears. */
export function spoken(ref: PromptRef, lang: Lang, overrides?: PromptOverrides): CallerStep {
  if (typeof ref === "object" && "audio" in ref) return { kind: "play_audio", url: ref.audio };
  const text = typeof ref === "string" ? (overrides?.[ref]?.[lang] || PROMPTS[ref][lang]) : ref.say[lang];
  return { kind: "say", text, lang, voiceLang: lang === "es" ? "es-US" : "en-US" };
}

/**
 * `voicemail` is the longest message allowed, or that plus the settings'
 * edited wording (`{ maxVoicemailSeconds, prompts }`).
 */
export function scriptFor(
  call: Call,
  effects: Effect[],
  now: number,
  voicemail: number | { maxVoicemailSeconds: number; prompts?: PromptOverrides },
): CallerStep[] {
  if (call.direction !== "inbound") return [];

  const { maxVoicemailSeconds, prompts: overrides } = typeof voicemail === "number" ? { maxVoicemailSeconds: voicemail, prompts: undefined } : voicemail;
  const prompts: PromptRef[] = effects.flatMap((e) => (e.type === "play" ? [e.prompt] : []));
  const say = (ref: PromptRef) => spoken(ref, call.lang, overrides);

  if (effects.some((e) => e.type === "hang_up_caller") || call.state === "ended") {
    return [...prompts.map(say), { kind: "hangup" }];
  }

  switch (call.state) {
    case "menu": {
      // A re-render (no new prompt this step) repeats the current menu's message.
      const menuPrompt: PromptRef | undefined =
        call.menuStep === "callback_offer" ? "callback_offer" : call.menu?.prompt;
      const spokenNow = prompts.length ? prompts : menuPrompt ? [menuPrompt] : [];
      const remaining = call.deadline ? Math.ceil((call.deadline.at - now) / 1000) : 0;
      return [
        ...spokenNow.map(say),
        {
          kind: "gather",
          timeoutSec: Math.max(1, remaining + 1),
          maxDigits: call.menu?.maxDigits ?? 1,
          finishOnKey: "#",
          ...(call.menu?.speechHints && { speechHints: call.menu.speechHints }),
        },
      ];
    }

    case "voicemail": {
      // Entering voicemail always plays its greeting; a re-render plays it again.
      const spokenNow = prompts.length ? prompts : [call.voicemailGreeting ?? "voicemail_greeting"];
      return [
        ...spokenNow.map(say),
        { kind: "record", maxSeconds: maxVoicemailSeconds, beep: true, finishOnKey: "#", silenceTimeoutSec: RECORD_SILENCE_SECONDS },
      ];
    }

    case "ringing":
    case "parked":
      return [...prompts.map(say), { kind: "hold", room: roomFor(call) }];

    case "answered":
      // Hold during a call (hold_caller) is done on the room, not by a new script.
      return [...prompts.map(say), { kind: "bridge", room: roomFor(call) }];

    case "dialing":
      return [];
  }
}
