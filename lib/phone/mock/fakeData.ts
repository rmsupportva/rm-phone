/**
 * Fake people and fake words for the demo. Nothing here is real: names are
 * invented and every number is in the 555-01xx range reserved for fiction.
 */
import type { Snapshot } from "../store";
import type { Agent, Call, Contact, Lang, Message, TranscriptTurn } from "../types";

export const DEMO_AGENTS: Agent[] = [
  { id: "va-maya", name: "Maya", presence: "available", speaksSpanish: false, queueIds: ["screening"] },
  { id: "va-lucia", name: "Lucía", presence: "available", speaksSpanish: true, queueIds: ["screening"] },
  { id: "va-noah", name: "Noah", presence: "available", speaksSpanish: false, queueIds: ["screening"] },
  { id: "va-sofia", name: "Sofía", presence: "away", speaksSpanish: true, queueIds: ["screening"] },
];

/** Texts to this pretend landline fail, so the demo can show a failed message. */
export const MOCK_LANDLINE = "+18455550199";

const N = {
  ana: "+18455550111",
  ben: "+18455550122",
  carmen: "+18455550133",
  dov: "+18455550144",
  elena: "+18455550155",
  frank: "+18455550166",
  grace: "+18455550177",
  hector: "+18455550188",
};

/** Numbers the demo can "call in" from. Their names come from the contacts below. */
export const DEMO_CALLERS = [N.ana, N.ben, N.carmen, N.dov, "+18455550123"];

const CONTACTS: Omit<Contact, "createdAt">[] = [
  { id: "ct-ana", name: "Ana Morales", numbers: [{ label: "Mobile", e164: N.ana }], notes: "Prefers texts in Spanish." },
  { id: "ct-ben", name: "Ben Carter", numbers: [{ label: "Mobile", e164: N.ben }] },
  {
    id: "ct-carmen",
    name: "Carmen Diaz",
    numbers: [
      { label: "Mobile", e164: N.carmen },
      { label: "Home", e164: MOCK_LANDLINE },
    ],
    notes: "Home number is a landline: texts to it fail.",
  },
  { id: "ct-dov", name: "Dov Weiss", numbers: [{ label: "Mobile", e164: N.dov }] },
  { id: "ct-elena", name: "Elena Park", numbers: [{ label: "Work", e164: N.elena }] },
  { id: "ct-frank", name: "Frank Osei", numbers: [{ label: "Mobile", e164: N.frank }] },
  { id: "ct-grace", name: "Grace Liu", numbers: [{ label: "Mobile", e164: N.grace }] },
  { id: "ct-hector", name: "Héctor Ruiz", numbers: [{ label: "Mobile", e164: N.hector }], notes: "Spanish speaker." },
];

/** The demo contacts on their own (for screens that only need names for numbers). */
export function demoContacts(): Contact[] {
  return CONTACTS.map((c) => ({ ...c, createdAt: 0 }));
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * A believable starting state: contacts, a few text conversations and some
 * past calls, dated relative to `now` so the demo always looks recent.
 */
export function demoSeed(now: number): Snapshot {
  const contacts: Contact[] = CONTACTS.map((c, i) => ({ ...c, createdAt: now - (30 - i) * 24 * HOUR }));

  let seq = 0;
  const msg = (number: string, direction: Message["direction"], minsAgo: number, body: string, agentId?: string): Message => ({
    id: `seed-msg-${++seq}`,
    number,
    direction,
    body,
    at: now - minsAgo * MIN,
    status: direction === "inbound" ? "received" : "delivered",
    ...(agentId ? { agentId } : {}),
  });

  const messages: Message[] = [
    msg(N.ana, "outbound", 190, "Hola Ana, le escribe Lucía de RM Support. ¿Tiene un momento para hablar hoy?", "va-lucia"),
    msg(N.ana, "inbound", 176, "Sí, después de las 3 por favor."),
    msg(N.ana, "outbound", 175, "Perfecto, la llamo a las 3. ¡Gracias!", "va-lucia"),
    msg(N.ana, "inbound", 12, "Estoy disponible ahora si quiere llamar."),
    msg(N.ben, "inbound", 55, "Hi, I missed a call from this number. What is it about?"),
    msg(N.ben, "outbound", 50, "Hi Ben, this is Maya from RM Support. We're following up on your food benefit screening. Is now a good time?", "va-maya"),
    msg(N.ben, "inbound", 48, "Tomorrow morning works better."),
    msg(N.grace, "outbound", 26 * 60, "Hi Grace, your screening is complete. Nothing else is needed from you. Have a great day!", "va-noah"),
    msg(N.grace, "inbound", 25 * 60, "Thank you so much!"),
    msg(N.frank, "inbound", 3 * 24 * 60, "STOP"),
    { ...msg(N.frank, "outbound", 3 * 24 * 60 - 1, "RM Support: You're unsubscribed and won't get more texts from this number. Reply START to resubscribe."), automatic: true },
  ];

  const calls: Call[] = [
    pastCall({ id: "seed-call-1", number: N.dov, startedAt: now - 35 * MIN, outcome: "voicemail", voicemailSeconds: 23 }),
    pastCall({ id: "seed-call-2", number: N.ben, startedAt: now - 70 * MIN, outcome: "missed" }),
    pastCall({ id: "seed-call-3", number: N.elena, startedAt: now - 3 * HOUR, outcome: "completed", agentId: "va-maya", talkSeconds: 312 }),
    pastCall({ id: "seed-call-4", number: N.hector, startedAt: now - 5 * HOUR, outcome: "completed", agentId: "va-lucia", talkSeconds: 184, lang: "es" }),
    pastCall({ id: "seed-call-5", number: N.carmen, startedAt: now - 26 * HOUR, outcome: "outbound", agentId: "va-noah", talkSeconds: 95 }),
    pastCall({ id: "seed-call-6", number: N.grace, startedAt: now - 27 * HOUR, outcome: "voicemail", voicemailSeconds: 14, heard: true }),
  ];

  return {
    calls,
    agents: structuredClone(DEMO_AGENTS),
    contacts,
    messages,
    optOuts: [N.frank],
    reads: { [N.grace]: now, [N.frank]: now },
  };
}

function pastCall(o: {
  id: string;
  number: string;
  startedAt: number;
  outcome: "completed" | "missed" | "voicemail" | "outbound";
  agentId?: string;
  talkSeconds?: number;
  voicemailSeconds?: number;
  lang?: Lang;
  heard?: boolean;
}): Call {
  const t = o.startedAt;
  const lang = o.lang ?? "en";
  const base = {
    id: o.id,
    lang,
    startedAt: t,
    ringingAgentIds: [],
    declinedAgentIds: [],
    state: "ended" as const,
  };
  const at = (s: number) => t + s * 1000;

  if (o.outcome === "outbound") {
    const talk = o.talkSeconds ?? 60;
    return {
      ...base,
      direction: "outbound",
      from: MAIN,
      to: o.number,
      agentId: o.agentId,
      answeredAt: at(6),
      endedAt: at(6 + talk),
      endReason: "completed",
      talkSeconds: talk,
      recording: { id: `${o.id}-rec`, seconds: talk },
      transcript: fakeTranscript(lang, talk),
      timeline: [
        { at: at(0), kind: "dialing" },
        { at: at(6), kind: "answered", detail: "Other side picked up" },
        { at: at(6 + talk), kind: "hung_up", detail: "Agent hung up" },
        { at: at(6 + talk), kind: "ended", detail: "Completed" },
      ],
    };
  }

  const intro = [
    { at: at(0), kind: "received" },
    { at: at(0), kind: "hours_checked", detail: "Open until 17:00" },
    { at: at(0), kind: "menu", detail: "Language menu" },
    { at: at(4), kind: "language", detail: `${lang === "es" ? "Spanish" : "English"} (Pressed ${lang === "es" ? 2 : 1})` },
    { at: at(8), kind: "menu_choice", detail: "Pressed 1: speak with someone" },
    { at: at(8), kind: "ringing", detail: "3 agents" },
  ];
  const inbound = { ...base, direction: "inbound" as const, from: o.number, to: MAIN, hoursState: "open" as const, queueId: "screening" };

  if (o.outcome === "completed") {
    const talk = o.talkSeconds ?? 60;
    return {
      ...inbound,
      agentId: o.agentId,
      answeredAt: at(14),
      endedAt: at(14 + talk),
      endReason: "completed",
      talkSeconds: talk,
      recording: { id: `${o.id}-rec`, seconds: talk },
      transcript: fakeTranscript(lang, talk),
      timeline: [
        ...intro,
        { at: at(14), kind: "answered", detail: DEMO_AGENTS.find((a) => a.id === o.agentId)?.name },
        { at: at(14 + talk), kind: "hung_up", detail: "Caller hung up" },
        { at: at(14 + talk), kind: "ended", detail: "Completed" },
      ],
    };
  }

  if (o.outcome === "missed") {
    return {
      ...inbound,
      endedAt: at(21),
      endReason: "missed",
      timeline: [
        ...intro,
        { at: at(21), kind: "hung_up", detail: "Caller hung up while ringing" },
        { at: at(21), kind: "ended", detail: "Missed" },
      ],
    };
  }

  const vm = o.voicemailSeconds ?? 15;
  return {
    ...inbound,
    endedAt: at(38 + 10 + vm),
    endReason: "voicemail",
    voicemail: { id: `${o.id}-vm`, seconds: vm },
    transcript: [{ atSecond: 0, speaker: "caller", text: VOICEMAIL_TEXT[lang] }],
    ...(o.heard ? { heardAt: at(3600) } : {}),
    timeline: [
      ...intro,
      { at: at(38), kind: "ring_no_answer", detail: "Nobody answered in 30s" },
      { at: at(38), kind: "voicemail" },
      { at: at(38 + 10 + vm), kind: "voicemail_saved", detail: `${vm}s` },
      { at: at(38 + 10 + vm), kind: "ended", detail: "Voicemail" },
    ],
  };
}

const MAIN = "+18455550100";

export const VOICEMAIL_TEXT: Record<Lang, string> = {
  en: "Hi, I'm calling back about the letter I got. Please call me back when you can. Thanks.",
  es: "Hola, llamo por la carta que recibí. Por favor devuélvame la llamada. Gracias.",
};

const LINES: Record<Lang, [TranscriptTurn["speaker"], string][]> = {
  en: [
    ["agent", "Thank you for calling RM Support, how can I help you today?"],
    ["caller", "Hi, I got a letter about the food benefit and wanted to ask about it."],
    ["agent", "Of course. Let me pull up your household."],
    ["caller", "Thank you."],
    ["agent", "I see it here. I can walk you through the next step."],
    ["caller", "That would be great."],
    ["agent", "Is there anything else I can help you with?"],
    ["caller", "No, that's everything. Thanks so much."],
  ],
  es: [
    ["agent", "Gracias por llamar a RM Support, ¿en qué le puedo ayudar?"],
    ["caller", "Hola, recibí una carta sobre el beneficio de comida."],
    ["agent", "Claro. Déjeme buscar su hogar."],
    ["caller", "Gracias."],
    ["agent", "Ya lo veo. Le explico el siguiente paso."],
    ["caller", "Perfecto."],
    ["agent", "¿Hay algo más en que le pueda ayudar?"],
    ["caller", "No, eso es todo. Muchas gracias."],
  ],
};

/** A made-up conversation spread evenly over the call's length. */
export function fakeTranscript(lang: Lang, seconds: number): TranscriptTurn[] {
  const lines = LINES[lang];
  const count = Math.max(2, Math.min(lines.length, Math.floor(seconds / 4)));
  const spacing = seconds / count;
  return lines.slice(0, count).map(([speaker, text], i) => ({
    atSecond: Math.round(i * spacing),
    speaker,
    text,
  }));
}
