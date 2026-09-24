"use client";

import { useState, type FormEvent } from "react";
import { DEMO_CALLERS } from "@/lib/phone/mock/fakeData";
import type { Agent, Call, Presence } from "@/lib/phone/types";
import { formatDuration, formatPhone, parsePhone, PRESENCE_VIEW } from "./format";
import { Icon } from "./Icon";
import { useDirectory, useNow, usePhoneData, useRuntime } from "./PhoneContext";
import { StatusBadge } from "./StatusBadge";

export function TeamPanel() {
  const { agents, calls } = usePhoneData();
  const ringingCount = calls.filter((c) => c.state === "ringing").length;

  return (
    <section className="panel" aria-labelledby="team-title">
      <div className="panel-head">
        <h2 id="team-title">Team phones</h2>
        <p className="panel-sub">Each card is one VA&apos;s softphone in the browser.</p>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {ringingCount > 0 ? `${ringingCount} call${ringingCount === 1 ? "" : "s"} ringing` : ""}
      </p>
      <ul className="agent-list">
        {agents.map((a) => (
          <li key={a.id}>
            <AgentPhone agent={a} calls={calls} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const CHOOSABLE: Presence[] = ["available", "away", "offline"];

function AgentPhone({ agent, calls }: { agent: Agent; calls: Call[] }) {
  const { engine } = useRuntime();
  const ringing = calls.filter(
    (c) =>
      (c.state === "ringing" && c.ringingAgentIds.includes(agent.id)) ||
      c.transfer?.ringingAgentIds.includes(agent.id) ||
      c.inviting?.ringingAgentIds.includes(agent.id),
  );
  const active = calls.find(
    (c) =>
      (c.agentId === agent.id && (c.state === "answered" || c.state === "dialing")) ||
      c.participants?.includes(agent.id) ||
      (c.transfer?.phase === "consulting" && c.transfer.answeredBy === agent.id),
  );
  const lastCall = calls.find((c) => c.agentId === agent.id && c.state === "ended");
  const isRinging = ringing.length > 0;

  return (
    <article className={`agent${isRinging ? " agent-ringing" : ""}`} aria-label={`${agent.name}'s phone`}>
      <header className="agent-head">
        <span className="avatar" aria-hidden="true">
          {agent.name[0]}
        </span>
        <span className="agent-name">
          <strong>{agent.name}</strong>
          {agent.speaksSpanish && <span className="tag" title="Speaks Spanish">ES</span>}
        </span>
        <StatusBadge view={PRESENCE_VIEW[agent.presence]} />
        <label className="visually-hidden" htmlFor={`presence-${agent.id}`}>
          {agent.name}&apos;s status
        </label>
        <select
          id={`presence-${agent.id}`}
          className="select select-small"
          value={CHOOSABLE.includes(agent.presence) ? agent.presence : ""}
          disabled={agent.presence === "busy"}
          onChange={(e) => engine.setPresence(agent.id, e.target.value as Presence)}
        >
          {!CHOOSABLE.includes(agent.presence) && <option value="">Set status…</option>}
          {CHOOSABLE.map((p) => (
            <option key={p} value={p}>
              {PRESENCE_VIEW[p].label}
            </option>
          ))}
        </select>
      </header>

      <div className="agent-body">
        {ringing.map((c) => (
          <IncomingCall key={c.id} call={c} agent={agent} />
        ))}
        {!isRinging && active && <ActiveCall call={active} agent={agent} />}
        {!isRinging && !active && agent.presence === "wrap_up" && (
          <div className="wrapup">
            <p>
              Wrap-up
              {lastCall?.talkSeconds !== undefined && <> after a {formatDuration(lastCall.talkSeconds)} call</>}.
              Add notes, then take the next call.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => engine.setPresence(agent.id, "available")}>
              Ready for next call
            </button>
          </div>
        )}
        {!isRinging && !active && agent.presence === "available" && <DialPad agent={agent} />}
        {!isRinging && !active && (agent.presence === "away" || agent.presence === "offline") && (
          <p className="muted agent-idle">Not taking calls.</p>
        )}
      </div>
    </article>
  );
}

function IncomingCall({ call, agent }: { call: Call; agent: Agent }) {
  const { engine } = useRuntime();
  const now = useNow();
  const left = call.deadline ? Math.max(0, Math.ceil((call.deadline.at - now) / 1000)) : 0;
  const { contactFor } = useDirectory();
  const { agents } = usePhoneData();
  const who = contactFor(call.from)?.name;
  const nameOf = (id?: string) => agents.find((a) => a.id === id)?.name ?? "A teammate";
  const why = call.transfer?.ringingAgentIds.includes(agent.id)
    ? `Transfer from ${nameOf(call.transfer.byAgentId)} · `
    : call.inviting?.ringingAgentIds.includes(agent.id)
      ? `${nameOf(call.inviting.byAgentId)} asks you to join · `
      : "";

  return (
    <div className="incoming" role="group" aria-label={`Incoming call from ${who ?? formatPhone(call.from)}`}>
      <div className="incoming-info">
        <span className="ring-icon">
          <Icon name="bell" size={18} />
        </span>
        <span>
          <strong>{formatPhone(call.from)}</strong>
          <span className="muted">
            {" "}
            {why}
            {who && `${who} · `}
            {call.lang === "es" ? "Spanish" : "English"} · {left}s
          </span>
        </span>
      </div>
      <div className="incoming-actions">
        <button type="button" className="btn btn-success" onClick={() => engine.answer(call.id, agent.id)}>
          Answer
        </button>
        <button type="button" className="btn" onClick={() => engine.decline(call.id, agent.id)}>
          Decline
        </button>
      </div>
    </div>
  );
}

function ActiveCall({ call, agent }: { call: Call; agent: Agent }) {
  const { engine } = useRuntime();
  const { contactFor } = useDirectory();
  const now = useNow();
  const number = call.direction === "inbound" ? call.from : call.to;
  const talking = call.state === "answered" && call.answeredAt !== undefined;
  const name = contactFor(number)?.name;

  return (
    <div className="active-call">
      <p>
        <strong>{talking ? "On a call" : "Calling"}</strong> {formatPhone(number)}
        {name && <span className="muted"> · {name}</span>}
      </p>
      <p className="call-clock" aria-live="off">
        {talking ? formatDuration((now - call.answeredAt!) / 1000) : "Ringing…"}
      </p>
      {call.participants?.includes(agent.id) ? (
        <button type="button" className="btn btn-danger" onClick={() => engine.leaveCall(call.id, agent.id)}>
          Leave call
        </button>
      ) : (
        <button type="button" className="btn btn-danger" onClick={() => engine.hangUp(call.id, agent.id)}>
          {talking ? "Hang up" : "Cancel"}
        </button>
      )}
    </div>
  );
}

function DialPad({ agent }: { agent: Agent }) {
  const { engine } = useRuntime();
  const { nameFor } = useDirectory();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputId = `dial-${agent.id}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const e164 = parsePhone(value);
    if (!e164) {
      setError("Enter a 10-digit US number.");
      return;
    }
    const placed = engine.placeOutbound(agent.id, e164);
    if (!placed.ok) {
      setError(placed.reason);
      return;
    }
    setError(null);
    setValue("");
  };

  return (
    <form className="dial" onSubmit={submit} noValidate>
      <label className="visually-hidden" htmlFor={inputId}>
        Number for {agent.name} to call
      </label>
      <div className="dial-row">
        <input
          id={inputId}
          className="input"
          inputMode="tel"
          autoComplete="off"
          placeholder="Number to call"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-err` : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          <Icon name="outgoing" />
          Call
        </button>
      </div>
      {error && (
        <p className="field-error" id={`${inputId}-err`}>
          {error}
        </p>
      )}
      <div className="quick-dial">
        {DEMO_CALLERS.slice(0, 3).map((number) => (
          <button key={number} type="button" className="link-btn" onClick={() => setValue(formatPhone(number))}>
            {nameFor(number)}
          </button>
        ))}
      </div>
    </form>
  );
}
