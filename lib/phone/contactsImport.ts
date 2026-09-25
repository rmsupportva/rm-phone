/**
 * Bringing contacts in from a spreadsheet (CSV), and finding the same person
 * entered twice. Pure: the server reads the file, calls these, and saves the plan.
 *
 * Columns are found by their heading, whatever the order: name (or first +
 * last), phone / cell / mobile / home (several allowed), language, family, note.
 * A number that's already someone's is never moved or duplicated; a bad row
 * is skipped with its line number and why.
 */
import type { Lang } from "./types";

export interface ContactRecord {
  id: string;
  name: string;
  lang: Lang;
  familyId: number | null;
  note: string | null;
  numbers: string[];
}

export interface ImportedContact {
  name: string;
  lang: Lang;
  familyId: number | null;
  note: string | null;
  numbers: string[];
}

export interface ImportPlan {
  /** New people. */
  add: ImportedContact[];
  /** New numbers for someone already saved (same name, new number). */
  addNumbers: { contactId: string; numbers: string[] }[];
  /** Rows left out, with the spreadsheet line and why (no names or numbers: identifiers only). */
  skipped: { line: number; why: string }[];
  /** Rows whose numbers are all saved already. */
  alreadySaved: number;
}

export const MAX_IMPORT_ROWS = 5000;
const MAX_NAME = 120;
const MAX_NOTE = 1000;

/** A US number as +1XXXXXXXXXX, or null. */
export function toUsE164(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? `+1${ten}` : null;
}

/** Split CSV text into rows (quotes, doubled quotes, commas and line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

type Role = "name" | "first" | "last" | "phone" | "lang" | "family" | "note";

function roleOf(heading: string): Role | null {
  const h = heading.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["name", "fullname", "contact", "contactname", "displayname"].includes(h)) return "name";
  if (["first", "firstname", "givenname"].includes(h)) return "first";
  if (["last", "lastname", "surname", "familyname"].includes(h)) return "last";
  if (/^(phone|cell|mobile|home|tel|telephone|number|phonenumber|cellphone|mobilephone|homephone|work|workphone)\d*$/.test(h)) return "phone";
  if (["language", "lang", "idioma"].includes(h)) return "lang";
  if (["family", "familyid", "carehub", "carehubid", "carehubfamily"].includes(h)) return "family";
  if (["note", "notes", "comment", "comments"].includes(h)) return "note";
  return null;
}

/** Same person? Names compared without case, accents, punctuation or extra spaces. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function planImport(csv: string, existing: ContactRecord[]): ImportPlan {
  const plan: ImportPlan = { add: [], addNumbers: [], skipped: [], alreadySaved: 0 };
  const rows = parseCsv(csv);
  if (!rows.length) return plan;
  const roles = rows[0].map(roleOf);
  const has = (r: Role) => roles.includes(r);
  if (!has("phone") || !(has("name") || has("first") || has("last"))) {
    plan.skipped.push({ line: 1, why: "The first row needs headings: a name column and at least one phone column." });
    return plan;
  }
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    plan.skipped.push({ line: 1, why: `At most ${MAX_IMPORT_ROWS} rows at a time.` });
    return plan;
  }

  const owner = new Map<string, string>(); // number → contact id or "new:<index>"
  for (const c of existing) for (const n of c.numbers) owner.set(n, c.id);
  const byName = new Map<string, ContactRecord>();
  for (const c of existing) byName.set(nameKey(c.name), c);
  const newByName = new Map<string, ImportedContact>();

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const pick = (r: Role) => cells.filter((_, j) => roles[j] === r).map((v) => v.trim()).filter(Boolean);
    const name = (pick("name")[0] ?? [pick("first")[0], pick("last")[0]].filter(Boolean).join(" ")).replace(/\s+/g, " ").slice(0, MAX_NAME);
    const raw = pick("phone");
    const numbers = [...new Set(raw.map(toUsE164).filter((n): n is string => n !== null))];
    if (!name) return void plan.skipped.push({ line, why: "No name." });
    if (!numbers.length) return void plan.skipped.push({ line, why: raw.length ? "No valid US phone number." : "No phone number." });

    const fresh = numbers.filter((n) => !owner.has(n));
    if (!fresh.length) return void plan.alreadySaved++;

    const langText = (pick("lang")[0] ?? "").toLowerCase();
    const lang: Lang = /^(es|spa|spanish|español|espanol)/.test(langText) ? "es" : "en";
    const familyText = pick("family")[0];
    const familyId = familyText && /^\d{1,15}$/.test(familyText) ? Number(familyText) : null;
    const note = pick("note").join(" · ").slice(0, MAX_NOTE) || null;

    const key = nameKey(name);
    const saved = byName.get(key);
    const pending = newByName.get(key);
    if (saved) {
      const entry = plan.addNumbers.find((a) => a.contactId === saved.id) ?? plan.addNumbers[plan.addNumbers.push({ contactId: saved.id, numbers: [] }) - 1];
      entry.numbers.push(...fresh);
      for (const n of fresh) owner.set(n, saved.id);
    } else if (pending) {
      pending.numbers.push(...fresh);
      for (const n of fresh) owner.set(n, "new");
    } else {
      const c: ImportedContact = { name, lang, familyId, note, numbers: fresh };
      plan.add.push(c);
      newByName.set(key, c);
      for (const n of fresh) owner.set(n, "new");
    }
  });
  return plan;
}

/**
 * The same person saved more than once (same name, ignoring case, accents and
 * punctuation). Each group lists the contact to keep first: the one with the
 * most numbers, ties in the order given.
 */
export function findDuplicates(contacts: ContactRecord[]): ContactRecord[][] {
  const groups = new Map<string, ContactRecord[]>();
  for (const c of contacts) {
    const key = nameKey(c.name);
    if (!key || /^[\d ]+$/.test(key)) continue; // a bare number isn't a name
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => b.numbers.length - a.numbers.length));
}

/** One contact from several: every number, the kept name and language, the first family set, notes joined. */
export function mergeContacts(keep: ContactRecord, others: ContactRecord[]): ContactRecord {
  const all = [keep, ...others];
  const notes = [...new Set(all.map((c) => c.note?.trim()).filter((n): n is string => !!n))];
  return {
    id: keep.id,
    name: keep.name,
    lang: keep.lang,
    familyId: keep.familyId ?? others.find((o) => o.familyId != null)?.familyId ?? null,
    note: notes.join("\n").slice(0, MAX_NOTE) || null,
    numbers: [...new Set(all.flatMap((c) => c.numbers))],
  };
}
