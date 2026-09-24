import type { Contact } from "./types";

/** Digits only, for matching and searching ("(845) 555-0111" → "8455550111"). */
export function digitsOf(value: string): string {
  const d = value.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

export function contactForNumber(contacts: Contact[], e164: string): Contact | undefined {
  const key = digitsOf(e164);
  return contacts.find((c) => c.numbers.some((n) => digitsOf(n.e164) === key));
}

/** Contacts sorted A→Z, filtered by name, number or note. */
export function searchContacts(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  const qDigits = digitsOf(q);
  const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name));
  if (!q) return sorted;
  return sorted.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.notes ?? "").toLowerCase().includes(q) ||
      (qDigits.length >= 3 && c.numbers.some((n) => digitsOf(n.e164).includes(qDigits))),
  );
}

/** Group sorted contacts under their first letter, for an A–Z list. */
export function groupByLetter(contacts: Contact[]): { letter: string; contacts: Contact[] }[] {
  const groups = new Map<string, Contact[]>();
  for (const c of contacts) {
    const first = c.name.trim()[0]?.toUpperCase() ?? "#";
    const letter = /[A-Z]/.test(first) ? first : "#";
    groups.set(letter, [...(groups.get(letter) ?? []), c]);
  }
  return [...groups.entries()].map(([letter, list]) => ({ letter, contacts: list }));
}

export interface ContactDraft {
  name: string;
  numbers: { label: string; value: string }[];
  notes: string;
}

export type ContactValidation =
  | { ok: true; contact: Omit<Contact, "id" | "createdAt"> }
  | { ok: false; errors: { name?: string; numbers?: string } };

/** Check a contact form and turn typed numbers into E.164. */
export function validateContact(
  draft: ContactDraft,
  parse: (input: string) => string | null,
  others: Contact[],
): ContactValidation {
  const errors: { name?: string; numbers?: string } = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Enter a name.";

  const filled = draft.numbers.filter((n) => n.value.trim());
  const numbers: Contact["numbers"] = [];
  for (const n of filled) {
    const e164 = parse(n.value);
    if (!e164) {
      errors.numbers = `"${n.value.trim()}" is not a 10-digit US number.`;
      break;
    }
    const taken = others.find((o) => o.numbers.some((x) => digitsOf(x.e164) === digitsOf(e164)));
    if (taken) {
      errors.numbers = `${n.value.trim()} already belongs to ${taken.name}.`;
      break;
    }
    numbers.push({ label: n.label.trim() || "Mobile", e164 });
  }
  if (!errors.numbers && numbers.length === 0) errors.numbers = "Add at least one phone number.";

  if (errors.name || errors.numbers) return { ok: false, errors };
  const notes = draft.notes.trim();
  return { ok: true, contact: { name, numbers, ...(notes ? { notes } : {}) } };
}
