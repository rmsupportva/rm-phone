import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { contactForNumber, searchContacts, validateContact } from "./contacts";
import { PhoneEngine } from "./engine";
import { checkOutgoing, keywordOf, listConversations, smsLength } from "./messaging";
import { MOCK_LANDLINE } from "./mock/fakeData";
import { MockProvider } from "./mock/mockProvider";
import { DEMO_SETTINGS } from "./settings";
import { MemoryStore } from "./store";
import type { Contact, Message } from "./types";

const NOW = Date.parse("2026-09-24T11:00:00-04:00");
const ANA = "+18455550111";

function setup() {
  let n = 0;
  const clock = new ManualClock(NOW);
  const store = new MemoryStore({
    agents: [{ id: "a", name: "A", presence: "available", speaksSpanish: false, queueIds: [] }],
  });
  const provider = new MockProvider({ clock, newId: () => `mock-${++n}`, greetingSeconds: 10, defer: (fn) => fn() });
  const errors: string[] = [];
  const engine = new PhoneEngine({
    store,
    provider,
    messaging: provider,
    clock,
    settings: DEMO_SETTINGS,
    newId: () => `id-${++n}`,
    reportError: (s) => errors.push(s),
  });
  engine.start();
  return { clock, store, provider, engine, errors };
}

describe("sending texts", () => {
  it("a sent text is delivered and appears in the conversation", () => {
    const t = setup();
    const r = t.engine.sendText("a", ANA, "  Hello there  ");
    expect(r.ok).toBe(true);
    const [m] = t.store.getMessages();
    expect(m).toMatchObject({ number: ANA, direction: "outbound", body: "Hello there", status: "delivered", agentId: "a" });
  });

  it("a text to a landline fails with a reason, and can be retried", () => {
    const t = setup();
    t.engine.sendText("a", MOCK_LANDLINE, "Hi");
    const [m] = t.store.getMessages();
    expect(m.status).toBe("failed");
    expect(m.error).toBe("Not a mobile number");
    expect(t.engine.retryText(m.id).ok).toBe(true);
    expect(t.store.getMessages()).toHaveLength(1); // retried in place, not duplicated
  });

  it("refuses an empty message", () => {
    const t = setup();
    expect(t.engine.sendText("a", ANA, "   ")).toEqual({ ok: false, reason: "Type a message first." });
    expect(t.store.getMessages()).toEqual([]);
  });
});

describe("STOP and START", () => {
  it("STOP unsubscribes, confirms once, and blocks further texts", () => {
    const t = setup();
    t.provider.receiveText(ANA, "stop");
    expect(t.store.getOptOuts()).toEqual([ANA]);
    const auto = t.store.getMessages().filter((m) => m.automatic);
    expect(auto).toHaveLength(1);
    expect(auto[0].body).toMatch(/unsubscribed/);

    t.provider.receiveText(ANA, "STOP"); // a second STOP gets no second confirmation
    expect(t.store.getMessages().filter((m) => m.automatic)).toHaveLength(1);

    const r = t.engine.sendText("a", ANA, "Are you there?");
    expect(r.ok).toBe(false);
  });

  it("START resubscribes and confirms", () => {
    const t = setup();
    t.provider.receiveText(ANA, "STOP");
    t.provider.receiveText(ANA, "Start!");
    expect(t.store.getOptOuts()).toEqual([]);
    expect(t.engine.sendText("a", ANA, "Welcome back").ok).toBe(true);
  });

  it("only a message that IS the keyword counts", () => {
    expect(keywordOf("Please stop calling me")).toBeNull();
    expect(keywordOf(" Unsubscribe. ")).toBe("stop");
    expect(keywordOf("unstop")).toBe("start");
  });
});

describe("conversations", () => {
  const msg = (number: string, direction: Message["direction"], at: number): Message => ({
    id: `${number}-${at}`,
    number,
    direction,
    body: "x",
    at,
    status: direction === "inbound" ? "received" : "delivered",
  });

  it("groups by number, newest first, counting unread inbound texts", () => {
    const list = listConversations(
      [msg(ANA, "inbound", 1), msg(ANA, "outbound", 2), msg(ANA, "inbound", 5), msg("+18455550122", "inbound", 3)],
      { [ANA]: 2 },
      [],
    );
    expect(list.map((c) => c.number)).toEqual([ANA, "+18455550122"]);
    expect(list[0].unread).toBe(1);
    expect(list[1].unread).toBe(1);
  });

  it("marking a conversation read clears its unread count", () => {
    const t = setup();
    t.provider.receiveText(ANA, "Hi");
    t.clock.advance(1);
    t.engine.markConversationRead(ANA);
    const [c] = listConversations(t.store.getMessages(), t.store.getSnapshot().reads, []);
    expect(c.unread).toBe(0);
  });
});

describe("message length", () => {
  it("plain text fits 160 characters in one text", () => {
    expect(smsLength("a".repeat(160))).toMatchObject({ segments: 1, encoding: "GSM-7", remaining: 0 });
    expect(smsLength("a".repeat(161))).toMatchObject({ segments: 2, remaining: 306 - 161 });
  });

  it("an emoji switches to the shorter encoding", () => {
    expect(smsLength("Hi 🙂").encoding).toBe("UCS-2");
    expect(smsLength("a".repeat(71)).encoding).toBe("GSM-7");
    expect(smsLength("¡Hola! ¿Cómo está?").encoding).toBe("UCS-2"); // ó is not in the GSM set
  });

  it("refuses messages over the limit", () => {
    expect(checkOutgoing("a".repeat(1601), ANA, []).ok).toBe(false);
  });
});

describe("contacts", () => {
  const parse = (s: string) => {
    const d = s.replace(/\D/g, "");
    return d.length === 10 ? `+1${d}` : null;
  };
  const existing: Contact[] = [
    { id: "c1", name: "Ana Morales", numbers: [{ label: "Mobile", e164: ANA }], createdAt: 0 },
  ];

  it("finds a contact by any format of their number", () => {
    expect(contactForNumber(existing, "+1 (845) 555-0111")?.name).toBe("Ana Morales");
  });

  it("searches by name and by part of a number", () => {
    expect(searchContacts(existing, "mora")).toHaveLength(1);
    expect(searchContacts(existing, "0111")).toHaveLength(1);
    expect(searchContacts(existing, "zzz")).toHaveLength(0);
  });

  it("validates a new contact", () => {
    const ok = validateContact(
      { name: " Ben ", numbers: [{ label: "", value: "845 555 0122" }], notes: "" },
      parse,
      existing,
    );
    expect(ok).toEqual({ ok: true, contact: { name: "Ben", numbers: [{ label: "Mobile", e164: "+18455550122" }] } });

    const bad = validateContact({ name: "", numbers: [{ label: "Mobile", value: "12" }], notes: "" }, parse, existing);
    expect(bad.ok).toBe(false);

    const dup = validateContact({ name: "X", numbers: [{ label: "Mobile", value: "8455550111" }], notes: "" }, parse, existing);
    expect(dup).toMatchObject({ ok: false, errors: { numbers: expect.stringMatching(/Ana Morales/) } });
  });

  it("the engine keeps an edited contact's id and creation date", () => {
    const t = setup();
    const id = t.engine.saveContact({ name: "Ana", numbers: [{ label: "Mobile", e164: ANA }] });
    t.clock.advance(60);
    t.engine.saveContact({ name: "Ana M.", numbers: [{ label: "Mobile", e164: ANA }] }, id);
    const [c] = t.store.getContacts();
    expect(c).toMatchObject({ id, name: "Ana M.", createdAt: NOW });
  });
});
