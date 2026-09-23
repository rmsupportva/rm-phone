"use client";

import { useEffect, useRef, useState } from "react";
import { needsCallback } from "@/lib/phone/callMachine";
import type { Call } from "@/lib/phone/types";
import { CallTimeline } from "./CallTimeline";
import {
  callerLabel,
  callStatus,
  formatDateTime,
  formatDuration,
  formatPhone,
  otherParty,
} from "./format";
import { Icon } from "./Icon";
import { usePhoneData } from "./PhoneContext";
import { StatusBadge } from "./StatusBadge";

type Filter = "all" | "callback" | "voicemail" | "completed" | "outbound";

const FILTERS: { id: Filter; label: string; test: (c: Call) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "callback", label: "To call back", test: needsCallback },
  { id: "voicemail", label: "Voicemail", test: (c) => c.endReason === "voicemail" },
  { id: "completed", label: "Talked", test: (c) => c.endReason === "completed" },
  { id: "outbound", label: "Outgoing", test: (c) => c.direction === "outbound" },
];

export function HistoryView() {
  const { calls, agents } = usePhoneData();
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const ended = calls.filter((c) => c.state === "ended");
  const shown = ended.filter(FILTERS.find((f) => f.id === filter)!.test);
  const open = calls.find((c) => c.id === openId);
  const agentName = (id?: string) => agents.find((a) => a.id === id)?.name ?? "—";

  return (
    <section className="panel panel-wide" aria-labelledby="history-title">
      <div className="panel-head panel-head-row">
        <div>
          <h2 id="history-title">Call history</h2>
          <p className="panel-sub">Finished calls, newest first. Saved in this browser only.</p>
        </div>
        <div className="segmented" role="group" aria-label="Filter calls">
          {FILTERS.map((f) => {
            const count = ended.filter(f.test).length;
            return (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} <span className="count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="empty">
          {ended.length === 0 ? "No finished calls yet. Make one on the Live tab." : "No calls match this filter."}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Outcome</th>
                <th scope="col">Handled by</th>
                <th scope="col" className="num">
                  Talk time
                </th>
                <th scope="col">
                  <span className="visually-hidden">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td>{formatDateTime(c.startedAt)}</td>
                  <td>
                    <span className="who-cell">
                      <Icon name={c.direction === "inbound" ? "incoming" : "outgoing"} size={14} />
                      <span className="visually-hidden">{c.direction === "inbound" ? "Incoming" : "Outgoing"}</span>
                      {formatPhone(otherParty(c))}
                      {callerLabel(otherParty(c)) && <span className="muted">{callerLabel(otherParty(c))}</span>}
                    </span>
                  </td>
                  <td>
                    <StatusBadge view={callStatus(c)} />
                  </td>
                  <td>{agentName(c.agentId)}</td>
                  <td className="num">{c.talkSeconds !== undefined ? formatDuration(c.talkSeconds) : "—"}</td>
                  <td>
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => setOpenId(c.id)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <CallDetails call={open} agentName={agentName(open.agentId)} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function CallDetails({ call, agentName, onClose }: { call: Call; agentName: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="details-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <h2 id="details-title">
            {call.direction === "inbound" ? "Call from" : "Call to"} {formatPhone(otherParty(call))}
          </h2>
          <button ref={closeRef} type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </header>

        <dl className="facts">
          <div>
            <dt>Outcome</dt>
            <dd>
              <StatusBadge view={callStatus(call)} />
            </dd>
          </div>
          <div>
            <dt>Started</dt>
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
          <section className="drawer-section">
            <h3>Voicemail</h3>
            <p className="recording">
              <Icon name="voicemail" /> Message, {formatDuration(call.voicemail.seconds)}
              <span className="muted"> (demo: no audio)</span>
            </p>
          </section>
        )}

        {call.recording && (
          <section className="drawer-section">
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
                      {t.speaker === "agent" ? agentName : "Caller"} · {formatDuration(t.atSecond)}
                    </span>
                    <span>{t.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <section className="drawer-section">
          <h3>What happened</h3>
          <CallTimeline call={call} />
        </section>
      </aside>
    </div>
  );
}
