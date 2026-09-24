/**
 * What an inbound CALLER hears and does right now, carrier-neutral.
 *
 * The call brain decides; this turns its decision into a short script the
 * carrier adapter renders (as cXML / SWML) and returns to the phone company
 * from a webhook: say this, then wait for a key; say this, then record; wait in
 * the call's room; hang up.
 *
 * `scriptFor(call, effects)` works from the call's CURRENT STATE, so any
 * webhook can ask for it again (e.g. a retried request) and get the same
 * answer. `effects` only adds the one-off prompts this step produced (such as
 * "we're closed" before the voicemail greeting).
 */
import { PROMPTS } from "./settings";
import type { Call, Effect, Lang, PromptId } from "./types";

export type CallerStep =
  /** Speak a prompt in the caller's language. */
  | { kind: "say"; text: string; lang: Lang; voiceLang: "en-US" | "es-US" }
  /**
   * Wait for ONE key. The key goes back as `caller_pressed`. With no key, the
   * adapter feeds `{ type: "timer", kind: "menu" }`: `timeoutSec` is set a
   * second past the menu deadline, so that timer is due by then.
   */
  | { kind: "gather"; timeoutSec: number }
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

export function scriptFor(call: Call, effects: Effect[], now: number, maxVoicemailSeconds: number): CallerStep[] {
  if (call.direction !== "inbound") return [];

  const prompts: PromptId[] = effects.flatMap((e) => (e.type === "play" ? [e.prompt] : []));
  const say = (id: PromptId): CallerStep => ({
    kind: "say",
    text: PROMPTS[id][call.lang],
    lang: call.lang,
    voiceLang: call.lang === "es" ? "es-US" : "en-US",
  });

  if (effects.some((e) => e.type === "hang_up_caller") || call.state === "ended") {
    return [...prompts.map(say), { kind: "hangup" }];
  }

  switch (call.state) {
    case "menu": {
      // A re-render (no new prompt this step) repeats the current menu.
      const menuPrompt: PromptId =
        call.menuStep === "language" ? "welcome_language" : call.menuStep === "callback_offer" ? "callback_offer" : "main_menu";
      const spoken = prompts.length ? prompts : [menuPrompt];
      const remaining = call.deadline ? Math.ceil((call.deadline.at - now) / 1000) : 0;
      return [...spoken.map(say), { kind: "gather", timeoutSec: Math.max(1, remaining + 1) }];
    }

    case "voicemail": {
      // The greeting always plays before the beep, even on a re-render.
      const spoken = prompts.includes("voicemail_greeting") ? prompts : [...prompts, "voicemail_greeting" as const];
      return [
        ...spoken.map(say),
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
