import { describe, expect, it } from "vitest";
import { findDuplicates, mergeContacts, nameKey, parseCsv, planImport, toUsE164, type ContactRecord } from "./contactsImport";

const saved = (id: string, name: string, numbers: string[], extra: Partial<ContactRecord> = {}): ContactRecord => ({
  id, name, lang: "en", familyId: null, note: null, numbers, ...extra,
});

describe("reading a spreadsheet", () => {
  it("handles quotes, commas and line breaks inside quotes, and a BOM", () => {
    expect(parseCsv('﻿Name,Phone\r\n"Rivera, Ana","(718) 555-0100"\n"Say ""hi""\nthere",7185550101\n')).toEqual([
      ["Name", "Phone"],
      ["Rivera, Ana", "(718) 555-0100"],
      ['Say "hi"\nthere', "7185550101"],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a,b\n\n,\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("US numbers only, in any common format", () => {
    expect(toUsE164("(718) 555-0100")).toBe("+17185550100");
    expect(toUsE164("1-718-555-0100")).toBe("+17185550100");
    expect(toUsE164("+44 20 7123 4567")).toBeNull();
    expect(toUsE164("555-0100")).toBeNull();
  });
});

describe("planning an import", () => {
  it("finds columns by heading, in any order, with several phone columns", () => {
    const csv = "Notes,Last Name,First Name,Cell,Home Phone,Language,Family ID\nCall after 5,Rivera,Ana,718-555-0100,(718) 555-0101,Spanish,4521\n";
    expect(planImport(csv, [])).toEqual({
      add: [{ name: "Ana Rivera", lang: "es", familyId: 4521, note: "Call after 5", numbers: ["+17185550100", "+17185550101"] }],
      addNumbers: [],
      skipped: [],
      alreadySaved: 0,
    });
  });

  it("skips bad rows with their line number and why, never their content", () => {
    const plan = planImport("name,phone\n,7185550100\nBen,\nCara,12345\nDan,7185550103\n", []);
    expect(plan.skipped).toEqual([
      { line: 2, why: "No name." },
      { line: 3, why: "No phone number." },
      { line: 4, why: "No valid US phone number." },
    ]);
    expect(plan.add.map((c) => c.name)).toEqual(["Dan"]);
  });

  it("needs a name and a phone heading", () => {
    expect(planImport("who,where\nAna,Bronx\n", []).skipped).toEqual([{ line: 1, why: "The first row needs headings: a name column and at least one phone column." }]);
  });

  it("never moves or repeats a number that's already saved", () => {
    const plan = planImport("name,phone\nSomeone Else,7185550100\n", [saved("c1", "Ana Rivera", ["+17185550100"])]);
    expect(plan).toMatchObject({ add: [], addNumbers: [], alreadySaved: 1 });
  });

  it("a saved name with a new number: the number joins that contact", () => {
    const plan = planImport("name,phone\nana  RIVERA,7185550102\n", [saved("c1", "Ana Rivera", ["+17185550100"])]);
    expect(plan.addNumbers).toEqual([{ contactId: "c1", numbers: ["+17185550102"] }]);
    expect(plan.add).toEqual([]);
  });

  it("the same person twice in the file becomes one contact", () => {
    const plan = planImport("name,phone\nBen Cruz,7185550104\nBen Cruz,7185550105\nBen Cruz,7185550104\n", []);
    expect(plan.add).toEqual([{ name: "Ben Cruz", lang: "en", familyId: null, note: null, numbers: ["+17185550104", "+17185550105"] }]);
    expect(plan.alreadySaved).toBe(1);
  });

  it("refuses a file that's too big", () => {
    const csv = "name,phone\n" + "A,7185550100\n".repeat(5001);
    expect(planImport(csv, []).skipped[0].why).toMatch(/At most 5000/);
  });
});

describe("duplicates", () => {
  it("groups the same name (case, accents, punctuation), the one with most numbers first", () => {
    const a = saved("1", "José Pérez", ["+17185550100"]);
    const b = saved("2", "jose perez", ["+17185550101", "+17185550102"]);
    const c = saved("3", "Ana", ["+17185550103"]);
    expect(findDuplicates([a, b, c])).toEqual([[b, a]]);
    expect(nameKey(" O'Neil,  Mary ")).toBe("o neil mary");
  });

  it("contacts named only by their number aren't duplicates of each other", () => {
    expect(findDuplicates([saved("1", "(718) 555-0100", ["+17185550100"]), saved("2", "(718) 555-0100", ["+17185550101"])])).toEqual([]);
  });

  it("merging keeps every number, the first family, and all notes", () => {
    const keep = saved("1", "Ana Rivera", ["+17185550100"], { note: "Prefers mornings" });
    const other = saved("2", "ana rivera", ["+17185550101", "+17185550100"], { familyId: 88, note: "Has two kids", lang: "es" });
    expect(mergeContacts(keep, [other])).toEqual({
      id: "1", name: "Ana Rivera", lang: "en", familyId: 88, note: "Prefers mornings\nHas two kids",
      numbers: ["+17185550100", "+17185550101"],
    });
  });
});
