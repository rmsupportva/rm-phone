"use client";

import { useState } from "react";
import { needsCallback } from "@/lib/phone/callMachine";
import type { Call } from "@/lib/phone/types";
import { CallTimeline } from "./CallTimeline";
import { callStatus, formatDateTime, formatDuration, formatListTime, formatPhone, otherParty } from "./format";
import { Avatar, BackButton, EmptyDetail, PaneHeader, SplitView } from "./common";
import { Icon } from "./Icon";
import { useCallNumber, useDirectory, useNow, usePhoneData, useShell } from "./PhoneContext";
import { StatusBadge } from "./StatusBadge";

type Filter = "all" | "missed" | "talked" | "outgoing";

const FILTERS: { id: Filter; label: string; test: (c: Call) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "missed", label: "Missed", test: (c) => needsCallback(c) && c.endReason !== "voicemail" },
  { id: "talked", label: "Talked", test: (c) => c.endReason === "completed" },
  { id: "outgoing", label: "Outgoing", test: (c) => c.direction === "outbound" },
];

export function CallsView() {
  const { calls } = usePhoneData();
  const { selection } = useShell();
  const open = calls.find((c) => c.id === selection);
  return (
    <SplitView
      hasSelection={selection !== null}
      list={<CallList />}
      detail={
        open ? (
          <CallDetail call={open} />
        ) : (
          <EmptyDetail icon="phone" title="Pick a call" hint="See what happened, listen back and read the transcript." />
        )
      }
    />
  );
}

function CallList() {
  const { calls, agents } = usePhoneData();
  const { selection, select } = useShell();
  const { nameFor } = useDirectory();
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>("all");
  const ended = calls.filter((c) => c.state === "ended");
  const shown = ended.filter(FILTERS.find((f) => f.id === filter)!.test);

  return (
    <>
      <PaneHeader title="Calls" />
      <div className="segmented segmented-fill" role="group" aria-label="Filter calls">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="empty">{ended.length === 0 ? "No calls yet." : "No calls match this filter."}</p>
      ) : (
        <ul className="rows" aria-label="Calls">
          {shown.map((c) => {
            const status = callStatus(c);
            const missed = status.tone === "danger";
            const agent = agents.find((a) => a.id === c.agentId)?.name;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="row"
                  aria-current={selection === c.id ? "true" : undefined}
                  onClick={() => select(c.id)}
                >
                  <Avatar name={nameFor(otherParty(c))} />
                  <span className="row-main">
                    <span className="row-top">
                      <span className={`row-title${missed ? " text-danger" : ""}`}>{nameFor(otherParty(c))}</span>
                      <span className="row-time">{formatListTime(c.startedAt, now)}</span>
                    </span>
                    <span className="row-sub">
                      <Icon name={missed ? "missed" : c.direction === "inbound" ? "incoming" : "outgoing"} size={13} />{" "}
                      {status.label}
                      {agent && ` · ${agent}`}
                      {c.talkSeconds !== undefined && ` · ${formatDuration(c.talkSeconds)}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** Everything about one call. Also used by the voicemail screen. */
export function CallDetail({ call }: { call: Call }) {
  const { agents } = usePhoneData();
  const { navigate } = useShell();
  const { contactFor, nameFor } = useDirectory();
  const callNumber = useCallNumber();
  const number = otherParty(call);
  const contact = contactFor(number);
  const agentName = agents.find((a) => a.id === call.agentId)?.name ?? "—";

  return (
    <div className="card-detail">
      <BackButton />
      <header className="call-hero">
        <Avatar name={nameFor(number)} size={56} />
        <div>
          <h2>{nameFor(number)}</h2>
          {contact && <p className="muted">{formatPhone(number)}</p>}
        </div>
      </header>

      <div className="hero-actions">
        <button type="button" className="btn btn-primary" onClick={() => callNumber(number)}>
          <Icon name="phone" />
          Call back
        </button>
        <button type="button" className="btn" onClick={() => navigate("messages", number)}>
          <Icon name="message" />
          Text
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
      </div>

      <dl className="facts">
        <div>
          <dt>Outcome</dt>
          <dd>
            <StatusBadge view={callStatus(call)} />
          </dd>
        </div>
        <div>
          <dt>{call.direction === "inbound" ? "Called in" : "Called out"}</dt>
          <dd>{formatDateTime(call.startedAt)}</dd>
        </div>
        <div>
          <dt>Handled by</dt>
          <dd>{agentName}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{call.lang === "es" ? "Spanish" : "English"}</dd>
        </div>
        {call.talkSeconds !== undefined && (
          <div>
            <dt>Talk time</dt>
            <dd>{formatDuration(call.talkSeconds)}</dd>
          </div>
        )}
      </dl>

      {call.voicemail && (
        <section className="detail-section">
          <h3>Voicemail</h3>
          <p className="recording">
            <Icon name="voicemail" /> Message, {formatDuration(call.voicemail.seconds)}
            <span className="muted"> (demo: no audio)</span>
          </p>
          {call.transcript?.[0] && <blockquote className="vm-text" lang={call.lang}>{call.transcript[0].text}</blockquote>}
        </section>
      )}

      {call.recording && (
        <section className="detail-section">
          <h3>Recording and transcript</h3>
          <p className="recording">
            <Icon name="talk" /> Recording, {formatDuration(call.recording.seconds)}
            <span className="muted"> (demo: no audio, made-up words)</span>
          </p>
          {call.transcript && (
            <ol className="transcript" lang={call.lang}>
              {call.transcript.map((t, i) => (
                <li key={i} className={`turn turn-${t.speaker}`}>
                  <span className="turn-meta">
                    {t.speaker === "agent" ? agentName : nameFor(number)} · {formatDuration(t.atSecond)}
                  </span>
                  <span>{t.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section className="detail-section">
        <h3>What happened</h3>
        <CallTimeline call={call} />
      </section>
    </div>
  );
}
