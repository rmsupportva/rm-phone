"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { searchContacts } from "@/lib/phone/contacts";
import { listConversations, smsLength, threadFor } from "@/lib/phone/messaging";
import type { Message } from "@/lib/phone/types";
import { formatDayHeading, formatListTime, formatPhone, formatShortTime, parsePhone, sameDay } from "./format";
import { Avatar, BackButton, EmptyDetail, PaneHeader, SearchBox, SplitView } from "./common";
import { Icon } from "./Icon";
import { useCallNumber, useDirectory, useNow, usePhoneData, useRuntime, useShell } from "./PhoneContext";

const NEW = "new";

export function MessagesView() {
  const { selection } = useShell();
  return (
    <SplitView
      hasSelection={selection !== null}
      list={<ConversationList />}
      detail={
        selection === NEW ? (
          <NewMessage />
        ) : selection ? (
          <Thread number={selection} />
        ) : (
          <EmptyDetail icon="message" title="Pick a conversation" hint="Or start a new message." />
        )
      }
    />
  );
}

function ConversationList() {
  const { messages, reads, optOuts } = usePhoneData();
  const { selection, select } = useShell();
  const { nameFor } = useDirectory();
  const now = useNow(30_000);
  const [query, setQuery] = useState("");

  const conversations = listConversations(messages, reads, optOuts);
  const q = query.trim().toLowerCase();
  const shown = q
    ? conversations.filter(
        (c) =>
          nameFor(c.number).toLowerCase().includes(q) ||
          c.number.includes(q.replace(/\D/g, "") || "~") ||
          threadFor(messages, c.number).some((m) => m.body.toLowerCase().includes(q)),
      )
    : conversations;

  return (
    <>
      <PaneHeader
        title="Messages"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => select(NEW)}>
            <Icon name="plus" />
            New message
          </button>
        }
      />
      <SearchBox value={query} onChange={setQuery} label="Search messages" />
      {shown.length === 0 ? (
        <p className="empty">{q ? "No conversations match." : "No messages yet."}</p>
      ) : (
        <ul className="rows" aria-label="Conversations">
          {shown.map((c) => {
            const name = nameFor(c.number);
            const preview = `${c.last.direction === "outbound" ? "You: " : ""}${c.last.body}`;
            return (
              <li key={c.number}>
                <button
                  type="button"
                  className={`row${c.unread ? " row-unread" : ""}`}
                  aria-current={selection === c.number ? "true" : undefined}
                  onClick={() => select(c.number)}
                >
                  <Avatar name={name} />
                  <span className="row-main">
                    <span className="row-top">
                      <span className="row-title">{name}</span>
                      <span className="row-time">{formatListTime(c.last.at, now)}</span>
                    </span>
                    <span className="row-sub">
                      {c.last.status === "failed" && (
                        <span className="row-flag">
                          <Icon name="alert" size={13} /> Not sent ·{" "}
                        </span>
                      )}
                      {preview}
                    </span>
                  </span>
                  {c.unread > 0 && (
                    <span className="unread-dot">
                      <span className="visually-hidden">{c.unread} unread</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Thread({ number }: { number: string }) {
  const { messages, optOuts, agents } = usePhoneData();
  const { engine, provider } = useRuntime();
  const { navigate } = useShell();
  const { contactFor, nameFor } = useDirectory();
  const callNumber = useCallNumber();
  const thread = useMemo(() => threadFor(messages, number), [messages, number]);
  const contact = contactFor(number);
  const optedOut = optOuts.includes(number);
  const endRef = useRef<HTMLLIElement>(null);

  // Opening a conversation (or a new text arriving in it while open) marks it read.
  const lastAt = thread[thread.length - 1]?.at ?? 0;
  useEffect(() => {
    engine.markConversationRead(number);
  }, [engine, number, lastAt]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.length]);

  const agentName = (id?: string) => agents.find((a) => a.id === id)?.name;

  return (
    <div className="thread">
      <header className="thread-head">
        <BackButton />
        <Avatar name={nameFor(number)} size={36} />
        <span className="thread-who">
          <strong>{nameFor(number)}</strong>
          {contact && <span className="muted">{formatPhone(number)}</span>}
        </span>
        <span className="thread-actions">
          <button type="button" className="btn" onClick={() => callNumber(number)}>
            <Icon name="phone" />
            Call
          </button>
          {contact ? (
            <button type="button" className="btn btn-quiet" onClick={() => navigate("contacts", contact.id)}>
              Contact
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => navigate("contacts", `new:${number}`)}>
              <Icon name="plus" />
              Add contact
            </button>
          )}
        </span>
      </header>

      <ol className="bubbles" aria-label={`Messages with ${nameFor(number)}`}>
        {thread.map((m, i) => (
          <Bubble key={m.id} message={m} previous={thread[i - 1]} agentName={agentName(m.agentId)} />
        ))}
        <li ref={endRef} aria-hidden="true" />
      </ol>

      <div className="demo-strip">
        <span className="demo-strip-label">Demo</span>
        <button type="button" className="link-btn" onClick={() => provider.receiveText(number, nextReply(number, thread))}>
          They text back
        </button>
        <button type="button" className="link-btn" onClick={() => provider.receiveText(number, optedOut ? "START" : "STOP")}>
          They reply {optedOut ? "START" : "STOP"}
        </button>
      </div>

      {optedOut ? (
        <p className="notice notice-warn thread-blocked">
          <Icon name="alert" /> This number replied STOP. You can&apos;t text them until they reply START. You can still
          call.
        </p>
      ) : (
        <Composer to={number} />
      )}
    </div>
  );
}

function Bubble({ message: m, previous, agentName }: { message: Message; previous?: Message; agentName?: string }) {
  const { engine } = useRuntime();
  const { toast } = useShell();
  const newDay = !previous || !sameDay(previous.at, m.at);
  const out = m.direction === "outbound";

  return (
    <>
      {newDay && (
        <li className="day-sep">
          <span>{formatDayHeading(m.at)}</span>
        </li>
      )}
      <li className={`bubble-row ${out ? "bubble-out" : "bubble-in"}`}>
        <div className={`bubble${m.status === "failed" ? " bubble-failed" : ""}${m.automatic ? " bubble-auto" : ""}`}>
          {m.body}
        </div>
        <div className="bubble-meta">
          {formatShortTime(m.at)}
          {out && (m.automatic ? " · Automatic reply" : agentName ? ` · ${agentName}` : "")}
          {out && m.status === "sending" && " · Sending…"}
          {out && m.status === "delivered" && " · Delivered"}
          {m.status === "failed" && (
            <>
              {" · "}
              <span className="bubble-error">
                <Icon name="alert" size={12} /> Not sent{m.error ? `: ${m.error}` : ""}
              </span>{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  const r = engine.retryText(m.id);
                  if (!r.ok) toast(r.reason, "error");
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>
      </li>
    </>
  );
}

function Composer({ to, onSent, autoFocus }: { to: string; onSent?: () => void; autoFocus?: boolean }) {
  const { engine } = useRuntime();
  const { me, toast } = useShell();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const length = smsLength(body);
  const showCount = body.length > 120 || length.encoding === "UCS-2";

  const send = () => {
    if (!me) {
      toast("Choose who you are first (bottom of the menu).", "error");
      return;
    }
    const r = engine.sendText(me.id, to, body);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    setBody("");
    setError(null);
    onSent?.();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <form className="composer" onSubmit={onSubmit}>
      <label className="visually-hidden" htmlFor={`compose-${to}`}>
        Message
      </label>
      <textarea
        id={`compose-${to}`}
        className="composer-input"
        rows={Math.min(5, Math.max(1, body.split("\n").length))}
        placeholder="Type a message"
        value={body}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `compose-err-${to}` : undefined}
        onChange={(e) => {
          setBody(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
      />
      <button type="submit" className="btn btn-primary composer-send" disabled={!body.trim()}>
        <Icon name="send" />
        <span className="visually-hidden">Send</span>
      </button>
      <div className="composer-foot">
        {error ? (
          <span className="field-error" id={`compose-err-${to}`}>
            {error}
          </span>
        ) : (
          <span className="muted">Enter to send · Shift+Enter for a new line</span>
        )}
        {showCount && (
          <span className="muted composer-count">
            {length.remaining} left · {length.segments} text{length.segments === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </form>
  );
}

function NewMessage() {
  const { contacts } = usePhoneData();
  const { select } = useShell();
  const [to, setTo] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const suggestions = to.trim() && !chosen ? searchContacts(contacts, to).slice(0, 6) : [];
  const typed = parsePhone(to);
  const target = chosen ?? typed;

  return (
    <div className="thread">
      <header className="thread-head">
        <BackButton />
        <strong>New message</strong>
      </header>
      <div className="new-to">
        <label htmlFor="new-to" className="field-label">
          To
        </label>
        <input
          id="new-to"
          className="input"
          placeholder="Name or phone number"
          autoComplete="off"
          autoFocus
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setChosen(null);
          }}
        />
        {suggestions.length > 0 && (
          <ul className="suggest" aria-label="Matching contacts">
            {suggestions.flatMap((c) =>
              c.numbers.map((n) => (
                <li key={`${c.id}-${n.e164}`}>
                  <button
                    type="button"
                    className="suggest-item"
                    onClick={() => {
                      setChosen(n.e164);
                      setTo(`${c.name} (${formatPhone(n.e164)})`);
                    }}
                  >
                    <Avatar name={c.name} size={28} />
                    <span>
                      {c.name} <span className="muted">{n.label} · {formatPhone(n.e164)}</span>
                    </span>
                  </button>
                </li>
              )),
            )}
          </ul>
        )}
        {to.trim() && !target && suggestions.length === 0 && (
          <p className="muted new-hint">Type a 10-digit number or a contact&apos;s name.</p>
        )}
      </div>
      <div className="thread-spacer" />
      {target ? (
        <Composer to={target} autoFocus onSent={() => select(target)} />
      ) : (
        <p className="muted composer-placeholder">Choose who to text first.</p>
      )}
    </div>
  );
}

const REPLIES = [
  "Thanks! I'll call you back later today.",
  "Can you send me the address again?",
  "Ok, got it.",
  "What documents do I need to bring?",
  "Gracias, lo reviso.",
];

function nextReply(number: string, thread: Message[]): string {
  const inbound = thread.filter((m) => m.direction === "inbound").length;
  return REPLIES[(inbound + number.length) % REPLIES.length];
}
