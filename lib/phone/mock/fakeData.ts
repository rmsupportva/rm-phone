/**
 * Fake people and fake words for the demo. Nothing here is real: names are
 * invented and every number is in the 555-01xx range reserved for fiction.
 */
import type { Agent, Lang, TranscriptTurn } from "../types";

export const DEMO_AGENTS: Agent[] = [
  { id: "va-maya", name: "Maya", presence: "available", speaksSpanish: false, queueIds: ["screening"] },
  { id: "va-lucia", name: "Lucía", presence: "available", speaksSpanish: true, queueIds: ["screening"] },
  { id: "va-noah", name: "Noah", presence: "available", speaksSpanish: false, queueIds: ["screening"] },
  { id: "va-sofia", name: "Sofía", presence: "away", speaksSpanish: true, queueIds: ["screening"] },
];

export const DEMO_CALLERS = [
  { label: "Caller A", number: "+18455550111" },
  { label: "Caller B", number: "+18455550122" },
  { label: "Caller C", number: "+18455550133" },
  { label: "Caller D", number: "+18455550144" },
];

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
