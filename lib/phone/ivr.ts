/**
 * The phone menu as data (old phone: ivr_flows), so it can be edited without
 * code. Every step type the old phone had is here:
 *
 *   menu         wait for keys (or spoken words); each option leads somewhere
 *   play         play a message, then go on
 *   set_language English or Spanish for the rest of the call
 *   hours        branch on open / closed / holiday
 *   agent_check  branch on whether anyone in a queue can take the call
 *   queue        ring a queue (ringing, overflow, callback offer …)
 *   voicemail    take a message (optionally with its own greeting)
 *   callback     save "call me back", thank the caller, hang up
 *   send_sms     text the caller, then go on (or say so and hang up)
 *   dial         ring one agent or an outside number; no answer goes on
 *   hangup       end the call
 *
 * Old rules kept: a menu with no match or no key goes to its default option,
 * or repeats when it has none; at most 25 steps per call (then "something went
 * wrong"); a flow that contains an `hours` step handles closing time itself.
 */
import type { Lang, PromptId } from "./types";

/** What to say: a built-in message, your own words in both languages, or a recording. */
export type PromptRef = PromptId | { say: Record<Lang, string> } | { audio: string };

export interface MenuOption {
  /** Keys that choose this option (exactly `maxDigits` long). */
  digits?: string;
  /** Spoken words that choose it, when the flow allows speech. */
  keywords?: string[];
  next: string;
}

export type IvrNode =
  | { id: string; type: "menu"; prompt?: PromptRef; maxDigits?: number; timeoutSec?: number; options: MenuOption[]; defaultNext?: string }
  | { id: string; type: "play"; prompt: PromptRef; next?: string }
  | { id: string; type: "set_language"; lang: Lang; next: string }
  | { id: string; type: "hours"; open: string; closed: string; holiday?: string }
  | { id: string; type: "agent_check"; queueId: string; available: string; unavailable: string }
  | { id: string; type: "queue"; queueId: string }
  | { id: string; type: "voicemail"; greeting?: PromptRef }
  | { id: string; type: "callback"; prompt?: PromptRef }
  | { id: string; type: "send_sms"; message: string; next?: string }
  | {
      id: string;
      type: "dial";
      to: { kind: "agent"; agentId: string } | { kind: "external"; number: string };
      timeoutSec?: number;
      prompt?: PromptRef;
      noAnswer?: string;
    }
  | { id: string; type: "hangup" };

export interface IvrFlow {
  rootId: string;
  nodes: IvrNode[];
  /** Let callers say an option instead of pressing it. */
  speech?: boolean;
}

/** Old phone: a menu waits 5 s by default, at least 2 s. */
export const DEFAULT_MENU_SECONDS = 5;
/** Old phone: a dial step rings 30 s by default, clamped to 5–120 s. */
export const DEFAULT_DIAL_SECONDS = 30;
/** Old phone: MAX_IVR_HOPS. */
export const MAX_IVR_STEPS = 25;

/**
 * Today's menu, as a flow: language (1 English / 2 Spanish, no key = English),
 * then 1 = speak with someone, 2 = leave a message, no key = the team.
 * `menuSeconds` keeps the current 15 s wait.
 */
export function defaultFlow(queueId: string, menuSeconds: number): IvrFlow {
  return {
    rootId: "language",
    nodes: [
      {
        id: "language",
        type: "menu",
        prompt: "welcome_language",
        timeoutSec: menuSeconds,
        options: [
          { digits: "1", next: "english" },
          { digits: "2", next: "spanish" },
        ],
        defaultNext: "english",
      },
      { id: "english", type: "set_language", lang: "en", next: "main" },
      { id: "spanish", type: "set_language", lang: "es", next: "main" },
      {
        id: "main",
        type: "menu",
        prompt: "main_menu",
        timeoutSec: menuSeconds,
        options: [
          { digits: "1", next: "team" },
          { digits: "2", next: "message" },
        ],
        defaultNext: "team",
      },
      { id: "team", type: "queue", queueId },
      { id: "message", type: "voicemail" },
    ],
  };
}

export function nodeById(flow: IvrFlow, id: string | undefined): IvrNode | undefined {
  return id ? flow.nodes.find((n) => n.id === id) : undefined;
}

export function flowHasHoursStep(flow: IvrFlow): boolean {
  return flow.nodes.some((n) => n.type === "hours");
}

/**
 * Old phone speech matching: a pressed key always wins; speech needs
 * confidence ≥ 0.5; a one-word keyword must match a whole word, a longer one
 * the phrase; the longest matching keyword wins.
 */
export function matchOption(node: Extract<IvrNode, { type: "menu" }>, input: { digits?: string; speech?: { text: string; confidence: number } }): MenuOption | undefined {
  if (input.digits !== undefined) return node.options.find((o) => o.digits === input.digits);
  const said = input.speech;
  if (!said || said.confidence < 0.5) return undefined;
  const text = ` ${said.text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()} `;
  let best: { option: MenuOption; length: number } | undefined;
  for (const option of node.options) {
    for (const kw of option.keywords ?? []) {
      const k = kw.toLowerCase().trim();
      if (k && text.includes(` ${k} `) && (!best || k.length > best.length)) best = { option, length: k.length };
    }
  }
  return best?.option;
}

/** Problems that would make a flow misbehave; empty = safe to save. (Old: lib/telephony/ivr.ts checks.) */
export function validateFlow(flow: IvrFlow): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of flow.nodes) {
    if (ids.has(n.id)) problems.push(`Two steps are called "${n.id}".`);
    ids.add(n.id);
  }
  const exists = (id: string | undefined, from: string, what: string) => {
    if (id !== undefined && !ids.has(id)) problems.push(`"${from}" ${what} goes to "${id}", which doesn't exist.`);
  };
  if (!ids.has(flow.rootId)) problems.push(`The first step "${flow.rootId}" doesn't exist.`);
  for (const n of flow.nodes) {
    switch (n.type) {
      case "menu": {
        const width = n.maxDigits ?? 1;
        if (!n.options.length && !n.defaultNext) problems.push(`Menu "${n.id}" needs at least one option or a default.`);
        const seenDigits = new Set<string>();
        const seenWords = new Set<string>();
        for (const o of n.options) {
          if (!o.digits && !o.keywords?.length) problems.push(`Every option in "${n.id}" needs keys or words.`);
          if (o.digits !== undefined) {
            if (!new RegExp(`^\\d{${width}}$`).test(o.digits)) problems.push(`In "${n.id}", "${o.digits}" must be exactly ${width} digit(s).`);
            if (seenDigits.has(o.digits)) problems.push(`In "${n.id}", "${o.digits}" is used twice.`);
            seenDigits.add(o.digits);
          }
          for (const w of o.keywords ?? []) {
            const k = w.toLowerCase().trim();
            if (seenWords.has(k)) problems.push(`In "${n.id}", the word "${w}" is used twice.`);
            seenWords.add(k);
          }
          exists(o.next, n.id, "an option");
        }
        exists(n.defaultNext, n.id, "the default");
        break;
      }
      case "play":
      case "send_sms":
        exists(n.next, n.id, "next");
        break;
      case "set_language":
        exists(n.next, n.id, "next");
        break;
      case "hours":
        exists(n.open, n.id, "open");
        exists(n.closed, n.id, "closed");
        exists(n.holiday, n.id, "holiday");
        break;
      case "agent_check":
        exists(n.available, n.id, "available");
        exists(n.unavailable, n.id, "unavailable");
        break;
      case "dial":
        exists(n.noAnswer, n.id, "no answer");
        break;
    }
  }
  // A loop that never waits for the caller would spin forever.
  for (const n of flow.nodes) {
    if (spinsForever(flow, n.id)) {
      problems.push(`Step "${n.id}" can loop without ever waiting for the caller.`);
      break;
    }
  }
  return problems;
}

/** Steps that move on by themselves (no caller input, no ringing). */
function autoNext(n: IvrNode): string[] {
  switch (n.type) {
    case "play":
    case "send_sms":
      return n.next ? [n.next] : [];
    case "set_language":
      return [n.next];
    case "hours":
      return [n.open, n.closed, ...(n.holiday ? [n.holiday] : [])];
    case "agent_check":
      return [n.available, n.unavailable];
    default:
      return [];
  }
}

function spinsForever(flow: IvrFlow, start: string): boolean {
  const onPath = new Set<string>();
  const visit = (id: string): boolean => {
    if (onPath.has(id)) return true;
    const node = nodeById(flow, id);
    if (!node) return false;
    onPath.add(id);
    const loops = autoNext(node).some(visit);
    onPath.delete(id);
    return loops;
  };
  return visit(start);
}
