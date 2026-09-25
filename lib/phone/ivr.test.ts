/**
 * The phone menu as data: every step type, the old phone's no-match and
 * step-limit rules, speech matching, closing time, the number's routing, and
 * the checks that stop a broken menu from being saved.
 */
import { describe, expect, it } from "vitest";
import { scriptFor } from "./callerScript";
import { MAX_IVR_STEPS, defaultFlow, matchOption, validateFlow, type IvrFlow, type IvrNode } from "./ivr";
import { DEMO_SETTINGS, type PhoneSettings } from "./settings";
import { CLOSED, HOLIDAY, OPEN, agents, harness } from "./testHarness";
import type { Effect } from "./types";

const withFlow = (flow: IvrFlow, extra: Partial<PhoneSettings> = {}): PhoneSettings => ({ ...DEMO_SETTINGS, ivr: flow, ...extra });
const flow = (rootId: string, nodes: IvrNode[], speech?: boolean): IvrFlow => ({ rootId, nodes, ...(speech && { speech }) });
const types = (fx: Effect[]) => fx.map((e) => e.type);
const played = (fx: Effect[]) => fx.flatMap((e) => (e.type === "play" ? [e.prompt] : []));

/** A menu: 1 → sales queue, 2 → a message, 3 → call me back, 4 → text me, 9 → hang up. */
const everything = flow("start", [
  { id: "start", type: "play", prompt: { say: { en: "Thanks for calling.", es: "Gracias por llamar." } }, next: "menu" },
  {
    id: "menu",
    type: "menu",
    prompt: "main_menu",
    timeoutSec: 6,
    options: [
      { digits: "1", keywords: ["agent", "talk to someone"], next: "team" },
      { digits: "2", keywords: ["message"], next: "vm" },
      { digits: "3", keywords: ["call me back"], next: "cb" },
      { digits: "4", next: "text" },
      { digits: "9", next: "bye" },
    ],
  },
  { id: "team", type: "queue", queueId: "screening" },
  { id: "vm", type: "voicemail", greeting: { audio: "https://example.test/greeting.mp3" } },
  { id: "cb", type: "callback" },
  { id: "text", type: "send_sms", message: "Here is our address." },
  { id: "bye", type: "hangup" },
]);

describe("the default menu is today's menu", () => {
  it("language, then main, with English and the team as the defaults", () => {
    const f = defaultFlow("screening", 15);
    expect(validateFlow(f)).toEqual([]);
    const h = harness(OPEN, agents(), withFlow(f)).inbound();
    expect(h.call.menu?.nodeId).toBe("language");
    expect(h.call.deadline).toMatchObject({ kind: "menu", at: OPEN + 15_000 });
    h.expire().expire();
    expect(h.call.state).toBe("ringing");
    expect(h.call.lang).toBe("en");
  });
});

describe("every step type", () => {
  const start = (settings = withFlow(everything), team = agents(), at = OPEN) => harness(at, team, settings).inbound();

  it("play runs straight on into the menu, and the caller hears both", () => {
    const h = start();
    expect(h.call.state).toBe("menu");
    expect(h.call.menu).toEqual({ nodeId: "menu", prompt: "main_menu", maxDigits: 1 });
    expect(played(h.effects)).toEqual([{ say: { en: "Thanks for calling.", es: "Gracias por llamar." } }, "main_menu"]);
    expect(scriptFor(h.call, h.effects, h.now, 120).map((s) => s.kind)).toEqual(["say", "say", "gather"]);
  });

  it("the menu waits its own time (at least 2 s)", () => {
    expect(start().call.deadline).toMatchObject({ kind: "menu", at: OPEN + 6_000 });
    const quick = flow("m", [{ id: "m", type: "menu", timeoutSec: 0, options: [{ digits: "1", next: "x" }] }, { id: "x", type: "hangup" }]);
    expect(start(withFlow(quick)).call.deadline).toMatchObject({ at: OPEN + 2_000 });
  });

  it("queue: rings the team", () => {
    const h = start().send({ type: "caller_pressed", digit: "1" });
    expect(h.call.state).toBe("ringing");
    expect(h.call.menu).toBeUndefined();
  });

  it("voicemail with its own greeting: the recording plays, and again on a re-render", () => {
    const h = start().send({ type: "caller_pressed", digit: "2" });
    expect(h.call.state).toBe("voicemail");
    const again = scriptFor(h.call, [], h.now, 120);
    expect(again).toEqual([{ kind: "play_audio", url: "https://example.test/greeting.mp3" }, expect.objectContaining({ kind: "record" })]);
  });

  it("callback: saved from the menu, thanked, hung up", () => {
    const h = start().send({ type: "caller_pressed", digit: "3" });
    expect(h.effects).toContainEqual({ type: "create_callback", source: "menu", from: "+18455550111", lang: "en" });
    expect(played(h.effects)).toContain("callback_menu_confirmed");
    expect(h.call.state).toBe("ended");
    expect(h.call.endReason).toBe("completed");
  });

  it("send_sms with no next step: texts the caller, says so, hangs up", () => {
    const h = start().send({ type: "caller_pressed", digit: "4" });
    expect(h.effects).toContainEqual({ type: "send_sms", to: "+18455550111", body: "Here is our address." });
    expect(played(h.effects)).toEqual(["sms_sent"]);
    expect(types(h.effects)).toContain("hang_up_caller");
    expect(h.call.endReason).toBe("completed");
  });

  it("send_sms with a next step goes on", () => {
    const f = flow("t", [{ id: "t", type: "send_sms", message: "Hi", next: "q" }, { id: "q", type: "queue", queueId: "screening" }]);
    const h = start(withFlow(f));
    expect(types(h.effects)).toContain("send_sms");
    expect(h.call.state).toBe("ringing");
  });

  it("hangup ends the call", () => {
    const h = start().send({ type: "caller_pressed", digit: "9" });
    expect(h.call.state).toBe("ended");
    expect(types(h.effects)).toContain("hang_up_caller");
  });

  it("play with no next step says it and hangs up", () => {
    const f = flow("p", [{ id: "p", type: "play", prompt: "goodbye" }]);
    const h = start(withFlow(f));
    expect(played(h.effects)).toEqual(["goodbye"]);
    expect(h.call.state).toBe("ended");
  });

  it("set_language switches every later message", () => {
    const f = flow("es", [{ id: "es", type: "set_language", lang: "es", next: "m" }, { id: "m", type: "menu", prompt: "main_menu", options: [{ digits: "1", next: "m" }] }]);
    const h = start(withFlow(f));
    expect(h.call.lang).toBe("es");
    expect(scriptFor(h.call, h.effects, h.now, 120)[0]).toMatchObject({ voiceLang: "es-US" });
  });

  it("hours: open, closed and holiday each take their own branch (holiday falls back to closed)", () => {
    const branch = (holiday?: string): IvrFlow =>
      flow("h", [
        { id: "h", type: "hours", open: "o", closed: "c", ...(holiday && { holiday }) },
        { id: "o", type: "queue", queueId: "screening" },
        { id: "c", type: "voicemail" },
        { id: "hol", type: "hangup" },
      ]);
    expect(start(withFlow(branch()), agents(), OPEN).call.state).toBe("ringing");
    expect(start(withFlow(branch()), agents(), CLOSED).call.state).toBe("voicemail");
    expect(start(withFlow(branch("hol")), agents(), HOLIDAY).call.state).toBe("ended");
    expect(start(withFlow(branch()), agents(), HOLIDAY).call.state).toBe("voicemail");
  });

  it("agent_check: free agent → available; a Spanish caller needs a Spanish speaker", () => {
    const f = (lang: "en" | "es") =>
      flow("l", [
        { id: "l", type: "set_language", lang, next: "chk" },
        { id: "chk", type: "agent_check", queueId: "screening", available: "q", unavailable: "vm" },
        { id: "q", type: "queue", queueId: "screening" },
        { id: "vm", type: "voicemail" },
      ]);
    expect(start(withFlow(f("en"))).call.state).toBe("ringing");
    const noSpanish = agents().map((a) => ({ ...a, speaksSpanish: false }));
    expect(start(withFlow(f("es")), noSpanish).call.state).toBe("voicemail");
    expect(start(withFlow(f("en")), noSpanish.map((a) => ({ ...a, presence: "away" as const }))).call.state).toBe("voicemail");
  });
});

describe("dial steps", () => {
  const toAgent = flow("d", [
    { id: "d", type: "dial", to: { kind: "agent", agentId: "b" }, timeoutSec: 20, noAnswer: "vm" },
    { id: "vm", type: "voicemail" },
  ]);
  const toNumber = (noAnswer?: string) =>
    flow("d", [
      { id: "d", type: "dial", to: { kind: "external", number: "+12125550100" }, timeoutSec: 500, ...(noAnswer && { noAnswer }) },
      { id: "vm", type: "voicemail" },
    ]);

  it("to an agent: rings only them; no answer goes to the no-answer step", () => {
    const h = harness(OPEN, agents(), withFlow(toAgent)).inbound();
    expect(h.call.state).toBe("ringing");
    expect(h.call.ringingAgentIds).toEqual(["b"]);
    expect(h.call.deadline).toMatchObject({ kind: "ring", at: OPEN + 20_000 });
    h.expire();
    expect(h.call.state).toBe("voicemail");
    expect(h.call.ivrDial).toBeUndefined();
  });

  it("to an agent who declines: the no-answer step straight away", () => {
    const h = harness(OPEN, agents(), withFlow(toAgent)).inbound().send({ type: "agent_declined", agentId: "b" });
    expect(h.call.state).toBe("voicemail");
  });

  it("to an agent who answers: a normal answered call", () => {
    const h = harness(OPEN, agents(), withFlow(toAgent)).inbound().send({ type: "agent_answered", agentId: "b" });
    expect(h.call.state).toBe("answered");
    expect(h.call.ivrDial).toBeUndefined();
  });

  it("to an outside number: rings at most 120 s; an answer hands the caller over", () => {
    const h = harness(OPEN, agents(), withFlow(toNumber())).inbound();
    expect(h.effects).toContainEqual({ type: "dial_external", to: "+12125550100" });
    expect(h.call.deadline).toMatchObject({ kind: "ring", at: OPEN + 120_000 });
    h.send({ type: "external_answered" });
    expect(h.effects).toContainEqual({ type: "release_to_external" });
    expect(h.call.endReason).toBe("transferred");
  });

  it("an outside number that fails goes to the no-answer step, hanging up the far leg", () => {
    const h = harness(OPEN, agents(), withFlow(toNumber("vm"))).inbound().send({ type: "external_failed" });
    expect(types(h.effects)).toContain("hang_up_external");
    expect(h.call.state).toBe("voicemail");
  });

  it("no answer and no no-answer step: 'nobody is available', a missed call", () => {
    const h = harness(OPEN, agents(), withFlow(toNumber())).inbound().expire();
    expect(played(h.effects)).toEqual(["no_agents"]);
    expect(h.call.endReason).toBe("missed");
  });

  it("an outside-number event with no outside dial changes nothing", () => {
    const h = harness(OPEN, agents(), withFlow(toAgent)).inbound();
    const before = h.call;
    h.send({ type: "external_answered" });
    expect(h.call).toBe(before);
  });
});

describe("no key, a wrong key, and the step limit", () => {
  const noDefault = flow("m", [{ id: "m", type: "menu", prompt: "main_menu", options: [{ digits: "1", next: "q" }] }, { id: "q", type: "queue", queueId: "screening" }]);

  it("a menu with no default repeats itself on a wrong key or silence", () => {
    const h = harness(OPEN, agents(), withFlow(noDefault)).inbound().send({ type: "caller_pressed", digit: "5" });
    expect(h.call.menu?.nodeId).toBe("m");
    expect(played(h.effects)).toEqual(["main_menu"]);
    h.expire();
    expect(h.call.menu?.nodeId).toBe("m");
  });

  it(`a caller who never presses is let go after ${MAX_IVR_STEPS} steps with "something went wrong"`, () => {
    const h = harness(OPEN, agents(), withFlow(noDefault)).inbound();
    for (let i = 0; i < MAX_IVR_STEPS && h.call.state === "menu"; i++) h.expire();
    expect(h.call.state).toBe("ended");
    expect(played(h.effects)).toEqual(["error_goodbye"]);
    expect(h.call.endReason).toBe("missed");
  });

  it("a step that points nowhere ends the call politely instead of crashing", () => {
    const broken = flow("m", [{ id: "m", type: "menu", options: [{ digits: "1", next: "gone" }] }]);
    const h = harness(OPEN, agents(), withFlow(broken)).inbound().send({ type: "caller_pressed", digit: "1" });
    expect(h.call.state).toBe("ended");
    expect(played(h.effects)).toEqual(["error_goodbye"]);
  });

  it("several keys: the menu asks for its width", () => {
    const wide = flow("m", [{ id: "m", type: "menu", maxDigits: 3, options: [{ digits: "123", next: "q" }] }, { id: "q", type: "queue", queueId: "screening" }]);
    const h = harness(OPEN, agents(), withFlow(wide)).inbound();
    expect(scriptFor(h.call, h.effects, h.now, 120).at(-1)).toMatchObject({ kind: "gather", maxDigits: 3 });
    h.send({ type: "caller_pressed", digit: "123" });
    expect(h.call.state).toBe("ringing");
  });
});

describe("speech", () => {
  const menu = everything.nodes.find((n) => n.id === "menu") as Extract<IvrNode, { type: "menu" }>;

  it("matches whole words, needs confidence 0.5, and the longest keyword wins", () => {
    expect(matchOption(menu, { speech: { text: "A MESSAGE please!", confidence: 0.9 } })?.next).toBe("vm");
    expect(matchOption(menu, { speech: { text: "messages", confidence: 0.9 } })).toBeUndefined();
    expect(matchOption(menu, { speech: { text: "message", confidence: 0.4 } })).toBeUndefined();
    expect(matchOption(menu, { speech: { text: "I want an agent to call me back", confidence: 0.8 } })?.next).toBe("cb");
  });

  it("a key always wins over words", () => {
    expect(matchOption(menu, { digits: "1", speech: { text: "message", confidence: 1 } })?.next).toBe("team");
  });

  it("with speech on, the gather listens for the keywords, and spoken words choose", () => {
    const h = harness(OPEN, agents(), withFlow({ ...everything, speech: true })).inbound();
    expect(h.call.menu?.speechHints).toEqual(["agent", "talk to someone", "message", "call me back"]);
    expect(scriptFor(h.call, h.effects, h.now, 120).at(-1)).toMatchObject({ speechHints: ["agent", "talk to someone", "message", "call me back"] });
    h.send({ type: "caller_spoke", text: "talk to someone", confidence: 0.7 });
    expect(h.call.state).toBe("ringing");
  });

  it("without speech on, the gather takes keys only", () => {
    const h = harness(OPEN, agents(), withFlow(everything)).inbound();
    expect(h.call.menu?.speechHints).toBeUndefined();
  });
});

describe("closing time and the number's routing", () => {
  const settings = (extra: Partial<PhoneSettings>) => ({ ...DEMO_SETTINGS, ...extra });

  it("closed: the after-hours action — voicemail by default, or goodbye, or another queue", () => {
    expect(harness(CLOSED).inbound().call.state).toBe("voicemail");
    const bye = harness(CLOSED, agents(), settings({ afterHours: { action: "hangup" } })).inbound();
    expect(played(bye.effects)).toEqual(["goodbye"]);
    expect(bye.call.state).toBe("ended");
    const q = harness(CLOSED, agents(), settings({ afterHours: { action: "queue", queueId: "screening" } })).inbound();
    expect(q.call.state).toBe("ringing");
  });

  it("a menu with its own hours step decides for itself after hours", () => {
    const f = flow("h", [
      { id: "h", type: "hours", open: "q", closed: "closed_menu" },
      { id: "q", type: "queue", queueId: "screening" },
      { id: "closed_menu", type: "menu", prompt: "closed", options: [{ digits: "1", next: "cb" }] },
      { id: "cb", type: "callback" },
    ]);
    const h = harness(CLOSED, agents(), withFlow(f)).inbound();
    expect(h.call.menu?.nodeId).toBe("closed_menu");
  });

  it("routing: straight to the queue, to voicemail, or no calls at all", () => {
    expect(harness(OPEN, agents(), settings({ routing: "queue" })).inbound().call.state).toBe("ringing");
    expect(harness(OPEN, agents(), settings({ routing: "voicemail" })).inbound().call.state).toBe("voicemail");
    const off = harness(OPEN, agents(), settings({ routing: "hangup" })).inbound();
    expect(off.call.state).toBe("ended");
    expect(played(off.effects)).toEqual(["goodbye"]);
  });
});

describe("checking a menu before it's saved", () => {
  it("the default menu and the full example are fine", () => {
    expect(validateFlow(defaultFlow("screening", 15))).toEqual([]);
    expect(validateFlow(everything)).toEqual([]);
  });

  it("finds missing steps, repeats, bad keys and empty menus", () => {
    const problems = validateFlow(
      flow("nope", [
        { id: "m", type: "menu", options: [{ digits: "1", next: "x" }, { digits: "1", next: "m" }, { digits: "12", next: "m" }, { next: "m" }] },
        { id: "m", type: "hangup" },
        { id: "empty", type: "menu", options: [] },
        { id: "w", type: "menu", options: [{ keywords: ["Help"], next: "w" }, { keywords: ["help "], next: "w" }] },
        { id: "d", type: "dial", to: { kind: "agent", agentId: "a" }, noAnswer: "gone" },
      ]),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        'Two steps are called "m".',
        'The first step "nope" doesn\'t exist.',
        '"m" an option goes to "x", which doesn\'t exist.',
        'In "m", "1" is used twice.',
        'In "m", "12" must be exactly 1 digit(s).',
        'Every option in "m" needs keys or words.',
        'Menu "empty" needs at least one option or a default.',
        'In "w", the word "help " is used twice.',
        '"d" no answer goes to "gone", which doesn\'t exist.',
      ]),
    );
  });

  it("finds a loop that never waits for the caller, but allows one through a menu", () => {
    const spin = flow("a", [
      { id: "a", type: "play", prompt: "goodbye", next: "b" },
      { id: "b", type: "set_language", lang: "en", next: "a" },
    ]);
    expect(validateFlow(spin)).toContain('Step "a" can loop without ever waiting for the caller.');
    const fine = flow("a", [
      { id: "a", type: "play", prompt: "goodbye", next: "m" },
      { id: "m", type: "menu", options: [{ digits: "1", next: "a" }] },
    ]);
    expect(validateFlow(fine)).toEqual([]);
  });
});
