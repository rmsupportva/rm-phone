"use client";

import { useState, type FormEvent } from "react";
import { digitsOf, groupByLetter, searchContacts, validateContact, type ContactDraft } from "@/lib/phone/contacts";
import { threadFor } from "@/lib/phone/messaging";
import type { Contact } from "@/lib/phone/types";
import { callStatus, formatListTime, formatPhone, otherParty, parsePhone } from "./format";
import { Avatar, BackButton, EmptyDetail, PaneHeader, SearchBox, SplitView } from "./common";
import { Icon } from "./Icon";
import { useCallNumber, useNow, usePhoneData, useRuntime, useShell } from "./PhoneContext";
import { StatusBadge } from "./StatusBadge";

/** Selection is a contact id, "new", or "new:+1…" (add a contact for a number seen elsewhere). */
export function ContactsView() {
  const { contacts } = usePhoneData();
  const { selection } = useShell();
  const [editing, setEditing] = useState<string | null>(null);

  let detail;
  if (selection?.startsWith("new")) {
    const number = selection.split(":")[1];
    detail = <ContactForm key={selection} initialNumber={number} />;
  } else if (selection) {
    const contact = contacts.find((c) => c.id === selection);
    detail = !contact ? (
      <EmptyDetail icon="contacts" title="Contact not found" hint="It may have been deleted." />
    ) : editing === contact.id ? (
      <ContactForm key={`edit-${contact.id}`} contact={contact} onDone={() => setEditing(null)} />
    ) : (
      <ContactCard contact={contact} onEdit={() => setEditing(contact.id)} />
    );
  } else {
    detail = <EmptyDetail icon="contacts" title="Pick a contact" hint="Everyone you call or text, in one place." />;
  }

  return <SplitView hasSelection={selection !== null} list={<ContactList />} detail={detail} />;
}

function ContactList() {
  const { contacts } = usePhoneData();
  const { selection, select } = useShell();
  const [query, setQuery] = useState("");
  const groups = groupByLetter(searchContacts(contacts, query));

  return (
    <>
      <PaneHeader
        title="Contacts"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => select("new")}>
            <Icon name="plus" />
            New contact
          </button>
        }
      />
      <SearchBox value={query} onChange={setQuery} label="Search contacts" />
      {groups.length === 0 ? (
        <p className="empty">{query ? "No contacts match." : "No contacts yet."}</p>
      ) : (
        groups.map((g) => (
          <section key={g.letter} aria-label={g.letter}>
            <h3 className="letter">{g.letter}</h3>
            <ul className="rows">
              {g.contacts.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="row"
                    aria-current={selection === c.id ? "true" : undefined}
                    onClick={() => select(c.id)}
                  >
                    <Avatar name={c.name} />
                    <span className="row-main">
                      <span className="row-title">{c.name}</span>
                      <span className="row-sub">
                        {formatPhone(c.numbers[0].e164)}
                        {c.numbers.length > 1 && ` +${c.numbers.length - 1} more`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function ContactCard({ contact, onEdit }: { contact: Contact; onEdit: () => void }) {
  const { calls, messages, optOuts } = usePhoneData();
  const { engine } = useRuntime();
  const { navigate, select, toast } = useShell();
  const callNumber = useCallNumber();
  const now = useNow(30_000);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const keys = contact.numbers.map((n) => digitsOf(n.e164));
  const recentCalls = calls.filter((c) => keys.includes(digitsOf(otherParty(c)))).slice(0, 5);
  const lastTexts = contact.numbers
    .map((n) => threadFor(messages, n.e164).at(-1))
    .filter((m) => m !== undefined)
    .sort((a, b) => b.at - a.at);

  return (
    <div className="card-detail">
      <BackButton />
      <header className="contact-hero">
        <Avatar name={contact.name} size={72} />
        <h2>{contact.name}</h2>
      </header>

      <ul className="numbers">
        {contact.numbers.map((n) => {
          const optedOut = optOuts.some((o) => digitsOf(o) === digitsOf(n.e164));
          return (
            <li key={n.e164} className="number-row">
              <span>
                <span className="number-value">{formatPhone(n.e164)}</span>
                <span className="muted"> {n.label}</span>
                {optedOut && <span className="tag tag-warn">Replied STOP</span>}
              </span>
              <span className="number-actions">
                <button type="button" className="btn" onClick={() => callNumber(n.e164)} aria-label={`Call ${n.label} ${formatPhone(n.e164)}`}>
                  <Icon name="phone" />
                  Call
                </button>
                <button type="button" className="btn" onClick={() => navigate("messages", n.e164)} aria-label={`Text ${n.label} ${formatPhone(n.e164)}`}>
                  <Icon name="message" />
                  Text
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {contact.notes && (
        <section className="detail-section">
          <h3>Notes</h3>
          <p className="notes">{contact.notes}</p>
        </section>
      )}

      <section className="detail-section">
        <h3>Recent activity</h3>
        {recentCalls.length === 0 && lastTexts.length === 0 ? (
          <p className="muted">No calls or texts yet.</p>
        ) : (
          <ul className="activity">
            {lastTexts.map((m) => (
              <li key={m.id}>
                <button type="button" className="activity-item" onClick={() => navigate("messages", m.number)}>
                  <Icon name="message" />
                  <span className="activity-text">
                    {m.direction === "outbound" ? "You: " : ""}
                    {m.body}
                  </span>
                  <span className="muted">{formatListTime(m.at, now)}</span>
                </button>
              </li>
            ))}
            {recentCalls.map((c) => (
              <li key={c.id}>
                <button type="button" className="activity-item" onClick={() => navigate(c.voicemail ? "voicemail" : "calls", c.id)}>
                  <Icon name={c.direction === "inbound" ? "incoming" : "outgoing"} />
                  <StatusBadge view={callStatus(c)} />
                  <span className="muted">{formatListTime(c.startedAt, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="detail-foot">
        <button type="button" className="btn" onClick={onEdit}>
          Edit
        </button>
        {confirmDelete ? (
          <span className="confirm" role="group" aria-label="Confirm delete">
            <span>Delete {contact.name}?</span>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                engine.deleteContact(contact.id);
                select(null);
                toast(`${contact.name} deleted.`);
              }}
            >
              Delete
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-danger-quiet" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </footer>
    </div>
  );
}

const LABELS = ["Mobile", "Home", "Work", "Other"];

function ContactForm({ contact, initialNumber, onDone }: { contact?: Contact; initialNumber?: string; onDone?: () => void }) {
  const { contacts } = usePhoneData();
  const { engine } = useRuntime();
  const { select, toast } = useShell();
  const [draft, setDraft] = useState<ContactDraft>(() => ({
    name: contact?.name ?? "",
    numbers: contact
      ? contact.numbers.map((n) => ({ label: n.label, value: formatPhone(n.e164) }))
      : [{ label: "Mobile", value: initialNumber ? formatPhone(initialNumber) : "" }],
    notes: contact?.notes ?? "",
  }));
  const [errors, setErrors] = useState<{ name?: string; numbers?: string }>({});

  const setNumber = (i: number, patch: Partial<ContactDraft["numbers"][number]>) =>
    setDraft((d) => ({ ...d, numbers: d.numbers.map((n, j) => (j === i ? { ...n, ...patch } : n)) }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const others = contacts.filter((c) => c.id !== contact?.id);
    const result = validateContact(draft, parsePhone, others);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const id = engine.saveContact(result.contact, contact?.id);
    toast(contact ? "Contact saved." : `${result.contact.name} added.`);
    onDone?.();
    select(id);
  };

  const cancel = () => (onDone ? onDone() : select(null));

  return (
    <form className="card-detail contact-form" onSubmit={submit} noValidate>
      <header className="form-head">
        <h2>{contact ? "Edit contact" : "New contact"}</h2>
      </header>

      <div className="field">
        <label htmlFor="c-name" className="field-label">
          Name
        </label>
        <input
          id="c-name"
          className="input"
          autoFocus
          value={draft.name}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "c-name-err" : undefined}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        {errors.name && (
          <p className="field-error" id="c-name-err">
            {errors.name}
          </p>
        )}
      </div>

      <fieldset className="field">
        <legend className="field-label">Phone numbers</legend>
        {draft.numbers.map((n, i) => (
          <div key={i} className="number-edit">
            <label className="visually-hidden" htmlFor={`c-label-${i}`}>
              Type of number {i + 1}
            </label>
            <select id={`c-label-${i}`} className="select" value={n.label} onChange={(e) => setNumber(i, { label: e.target.value })}>
              {LABELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <label className="visually-hidden" htmlFor={`c-num-${i}`}>
              Number {i + 1}
            </label>
            <input
              id={`c-num-${i}`}
              className="input"
              inputMode="tel"
              placeholder="(845) 555-0100"
              value={n.value}
              aria-invalid={errors.numbers ? true : undefined}
              onChange={(e) => setNumber(i, { value: e.target.value })}
            />
            {draft.numbers.length > 1 && (
              <button
                type="button"
                className="btn btn-quiet"
                aria-label={`Remove number ${i + 1}`}
                onClick={() => setDraft((d) => ({ ...d, numbers: d.numbers.filter((_, j) => j !== i) }))}
              >
                <Icon name="x" />
              </button>
            )}
          </div>
        ))}
        {errors.numbers && <p className="field-error">{errors.numbers}</p>}
        {draft.numbers.length < 4 && (
          <button
            type="button"
            className="link-btn"
            onClick={() => setDraft((d) => ({ ...d, numbers: [...d.numbers, { label: "Mobile", value: "" }] }))}
          >
            + Add another number
          </button>
        )}
      </fieldset>

      <div className="field">
        <label htmlFor="c-notes" className="field-label">
          Notes
        </label>
        <textarea
          id="c-notes"
          className="input textarea"
          rows={3}
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
        />
      </div>

      <footer className="detail-foot">
        <button type="submit" className="btn btn-primary">
          {contact ? "Save" : "Add contact"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={cancel}>
          Cancel
        </button>
      </footer>
    </form>
  );
}
