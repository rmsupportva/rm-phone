"use client";

import { useState, type FormEvent } from "react";
import type { Call } from "@/lib/phone/types";
import { formatDuration, formatPhone, otherParty, parsePhone } from "./format";
import { Avatar } from "./common";
import { Icon } from "./Icon";
import { useDirectory, useNow, usePhoneData, useRuntime, useShell } from "./PhoneContext";

/**
 * The signed-in person's phone, floating over every screen: incoming rings
 * (new calls, transfers to them, requests to join a call), the call in
 * progress with Hold / Park / Transfer / Add VA, wrap-up, and parked calls
 * anyone can pick up. Like the call window in Google Voice.
 */
export function CallDock() {
  const { calls } = usePhoneData();
  const { me } = useShell();
  if (!me) return null;

  const ringing = calls.filter(
    (c) =>
      (c.state === "ringing" && c.ringingAgentIds.includes(me.id)) ||
      c.transfer?.ringingAgentIds.includes(me.id) ||
      c.inviting?.ringingAgentIds.includes(me.id),
  );
  const active = calls.find(
    (c) =>
      (c.agentId === me.id && (c.state === "answered" || c.state === "dialing")) ||
      c.participants?.includes(me.id) ||
      (c.transfer?.phase === "consulting" && c.transfer.answeredBy === me.id),
  );
  const parked = calls.filter((c) => c.state === "parked");
  const wrapUp = !active && me.presence === "wrap_up";
  if (!ringing.length && !active && !wrapUp && !parked.length) return null;

  return (
    <aside className="dock" aria-label="Your phone">
      {ringing.map((c) => (
        <Incoming key={c.id} call={c} />
      ))}
      {active && !ringing.length && <Active call={active} />}
      {wrapUp && !ringing.length && <WrapUp />}
      {parked.length > 0 && !ringing.length && <Parked calls={parked} canPickUp={me.presence === "available"} />}
    </aside>
  );
}

function Incoming({ call }: { call: Call }) {
  const { engine } = useRuntime();
  const { me } = useShell();
  const { agents } = usePhoneData();
  const { nameFor } = useDirectory();
  const now = useNow();
  if (!me) return null;
  const left = call.deadline ? Math.max(0, Math.ceil((call.deadline.at - now) / 1000)) : 0;
  const nameOf = (id?: string) => agents.find((a) => a.id === id)?.name ?? "A teammate";
  const why = call.transfer?.ringingAgentIds.includes(me.id)
    ? `Transfer from ${nameOf(call.transfer.byAgentId)}`
    : call.inviting?.ringingAgentIds.includes(me.id)
      ? `${nameOf(call.inviting.byAgentId)} asks you to join`
      : "Incoming";
  const who = nameFor(otherParty(call));

  return (
    <div className="dock-card dock-ringing" role="alertdialog" aria-label={`${why}: ${who}`}>
      <div className="dock-top">
        <span className="ring-icon">
          <Icon name="bell" size={18} />
        </span>
        <span className="dock-who">
          <strong>{who}</strong>
          <span className="muted">
            {why} · {call.lang === "es" ? "Spanish" : "English"} · {left}s
          </span>
        </span>
      </div>
      <div className="dock-actions">
        <button type="button" className="btn btn-success" onClick={() => engine.answer(call.id, me.id)}>
          Answer
        </button>
        <button type="button" className="btn" onClick={() => engine.decline(call.id, me.id)}>
          Decline
        </button>
      </div>
    </div>
  );
}

type Panel = null | "transfer" | "invite";

function Active({ call }: { call: Call }) {
  const { agents } = usePhoneData();
  const { engine, provider } = useRuntime();
  const { me, navigate } = useShell();
  const { nameFor, contactFor } = useDirectory();
  const now = useNow();
  const [panel, setPanel] = useState<Panel>(null);
  if (!me) return null;

  const number = otherParty(call);
  const talking = call.state === "answered" && call.answeredAt !== undefined;
  const isMine = call.agentId === me.id;
  const t = call.transfer;
  const nameOf = (id?: string) => agents.find((a) => a.id === id)?.name ?? "—";
  const joinedAs = call.participants?.includes(me.id)
    ? `Joined ${nameOf(call.agentId)}'s call`
    : t?.answeredBy === me.id
      ? `${nameOf(t.byAgentId)} is transferring this caller to you`
      : null;

  let status = talking ? "On a call" : "Calling…";
  if (call.onHold) status = "Caller on hold";
  if (t?.phase === "ringing") status = `Transferring to ${transferLabel(t.target, nameOf)}…`;
  if (t?.phase === "consulting") status = `Talking to ${t.target.kind === "external" ? t.target.to : nameOf(t.answeredBy)} (caller on hold)`;
  if (call.inviting) status = `Ringing ${call.inviting.ringingAgentIds.map(nameOf).join(", ")} to join…`;

  const others = (call.participants ?? []).filter((p) => p !== me.id).map(nameOf);

  return (
    <div className="dock-card">
      <div className="dock-top">
        <Avatar name={nameFor(number)} size={40} />
        <span className="dock-who">
          <strong>{nameFor(number)}</strong>
          <span className="muted">
            {joinedAs ?? (talking ? (contactFor(number) ? formatPhone(number) : "On a call") : "Calling…")}
            {others.length > 0 && ` · with ${others.join(", ")}`}
          </span>
        </span>
        <span className="dock-clock" aria-live="off">
          {talking ? formatDuration((now - call.answeredAt!) / 1000) : "Ringing"}
        </span>
      </div>
      {isMine && talking && (call.onHold || t || call.inviting) && (
        <p className="dock-status">
          <Icon name={call.onHold ? "pause" : "talk"} size={14} /> {status}
        </p>
      )}

      {/* The handling agent's controls */}
      {isMine && talking && !t && !call.inviting && panel === null && (
        <div className="dock-controls" role="group" aria-label="Call controls">
          <button
            type="button"
            className="btn btn-small"
            aria-pressed={Boolean(call.onHold)}
            onClick={() => (call.onHold ? engine.resume(call.id, me.id) : engine.hold(call.id, me.id))}
          >
            <Icon name="pause" size={14} />
            {call.onHold ? "Resume" : "Hold"}
          </button>
          <button type="button" className="btn btn-small" onClick={() => engine.park(call.id, me.id)}>
            Park
          </button>
          <button type="button" className="btn btn-small" onClick={() => setPanel("transfer")}>
            <Icon name="outgoing" size={14} />
            Transfer
          </button>
          <button type="button" className="btn btn-small" onClick={() => setPanel("invite")}>
            <Icon name="team" size={14} />
            Add VA
          </button>
        </div>
      )}
      {isMine && panel === "transfer" && !t && (
        <TransferPanel call={call} onClose={() => setPanel(null)} />
      )}
      {isMine && panel === "invite" && !call.inviting && (
        <InvitePanel call={call} onClose={() => setPanel(null)} />
      )}
      {isMine && t && (
        <div className="dock-controls">
          {t.phase === "consulting" && (
            <button type="button" className="btn btn-small btn-primary" onClick={() => engine.completeTransfer(call.id, me.id)}>
              Complete transfer
            </button>
          )}
          <button type="button" className="btn btn-small" onClick={() => engine.cancelTransfer(call.id, me.id)}>
            Cancel transfer
          </button>
        </div>
      )}
      {isMine && call.inviting && (
        <div className="dock-controls">
          <button type="button" className="btn btn-small" onClick={() => engine.cancelInvite(call.id, me.id)}>
            Stop ringing
          </button>
        </div>
      )}

      <div className="dock-actions">
        {call.participants?.includes(me.id) ? (
          <button type="button" className="btn btn-danger" onClick={() => engine.leaveCall(call.id, me.id)}>
            Leave call
          </button>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => engine.hangUp(call.id, me.id)}>
            {talking ? "Hang up" : "Cancel"}
          </button>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => navigate("messages", number)}>
          <Icon name="message" />
          Text
        </button>
      </div>

      {call.state === "dialing" && (
        <div className="demo-strip">
          <span className="demo-strip-label">Demo</span>
          <button type="button" className="link-btn" onClick={() => provider.farEndAnswers(call.id)}>
            They pick up
          </button>
          <button type="button" className="link-btn" onClick={() => provider.callerHangsUp(call.id)}>
            They reject
          </button>
        </div>
      )}
      {talking && (
        <div className="demo-strip">
          <span className="demo-strip-label">Demo</span>
          {t?.target.kind === "external" && t.phase === "ringing" && (
            <>
              <button type="button" className="link-btn" onClick={() => provider.externalAnswers(call.id)}>
                Outside number picks up
              </button>
              <button type="button" className="link-btn" onClick={() => provider.externalFails(call.id)}>
                Can&apos;t reach it
              </button>
            </>
          )}
          <button type="button" className="link-btn" onClick={() => provider.callerHangsUp(call.id)}>
            They hang up
          </button>
        </div>
      )}
    </div>
  );
}

function transferLabel(target: NonNullable<Call["transfer"]>["target"], nameOf: (id?: string) => string): string {
  if (target.kind === "agent") return nameOf(target.agentId);
  if (target.kind === "queue") return "the whole line";
  return formatPhone(target.to);
}

function TransferPanel({ call, onClose }: { call: Call; onClose: () => void }) {
  const { agents } = usePhoneData();
  const { engine } = useRuntime();
  const { me } = useShell();
  const [mode, setMode] = useState<"warm" | "blind">("warm");
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const teammates = agents.filter((a) => a.id !== me.id);

  const go = (target: Parameters<typeof engine.transfer>[3]) => {
    engine.transfer(call.id, me.id, mode, target);
    onClose();
  };
  const toNumber = (e: FormEvent) => {
    e.preventDefault();
    const e164 = parsePhone(number);
    if (!e164) {
      setError("Enter a 10-digit US number.");
      return;
    }
    go({ kind: "external", to: e164 });
  };

  return (
    <div className="dock-panel" role="group" aria-label="Transfer">
      <div className="segmented segmented-fill" role="group" aria-label="How to transfer">
        <button type="button" aria-pressed={mode === "warm"} onClick={() => setMode("warm")}>
          Talk to them first
        </button>
        <button type="button" aria-pressed={mode === "blind"} onClick={() => setMode("blind")}>
          Send right away
        </button>
      </div>
      <ul className="dock-pick">
        {teammates.map((a) => (
          <li key={a.id}>
            <button type="button" className="dock-pick-item" disabled={a.presence !== "available"} onClick={() => go({ kind: "agent", agentId: a.id })}>
              <Avatar name={a.name} size={28} />
              <span>{a.name}</span>
              <span className="muted">{a.presence === "available" ? "Available" : "Not available"}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="dock-pick-item" onClick={() => go({ kind: "queue" })}>
            <span className="avatar avatar-green" style={{ width: 28, height: 28, fontSize: 11 }} aria-hidden="true">
              <Icon name="team" size={14} />
            </span>
            <span>The whole line</span>
            <span className="muted">first to answer</span>
          </button>
        </li>
      </ul>
      <form className="dock-number" onSubmit={toNumber} noValidate>
        <label className="visually-hidden" htmlFor="xfer-number">
          Outside number
        </label>
        <input
          id="xfer-number"
          className="input"
          inputMode="tel"
          placeholder="Or an outside number"
          value={number}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setNumber(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn btn-small">
          Transfer
        </button>
      </form>
      {error && <p className="field-error">{error}</p>}
      <button type="button" className="link-btn" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function InvitePanel({ call, onClose }: { call: Call; onClose: () => void }) {
  const { agents } = usePhoneData();
  const { engine } = useRuntime();
  const { me } = useShell();
  if (!me) return null;
  const vas = agents.filter((a) => a.id !== me.id && !call.participants?.includes(a.id));
  const available = vas.filter((a) => a.presence === "available");
  const spanish = available.filter((a) => a.speaksSpanish);

  const ring = (ids: string[]) => {
    engine.invite(call.id, me.id, ids);
    onClose();
  };

  return (
    <div className="dock-panel" role="group" aria-label="Add someone to the call">
      {spanish.length > 0 && (
        <button type="button" className="btn btn-block" onClick={() => ring(spanish.map((a) => a.id))}>
          Ring every Spanish speaker ({spanish.length})
        </button>
      )}
      <ul className="dock-pick">
        {vas.map((a) => (
          <li key={a.id}>
            <button type="button" className="dock-pick-item" disabled={a.presence !== "available"} onClick={() => ring([a.id])}>
              <Avatar name={a.name} size={28} />
              <span>
                {a.name}
                {a.speaksSpanish && <span className="tag">ES</span>}
              </span>
              <span className="muted">{a.presence === "available" ? "Available" : "Not available"}</span>
            </button>
          </li>
        ))}
      </ul>
      {available.length === 0 && <p className="muted">Nobody is free to join right now.</p>}
      <button type="button" className="link-btn" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function Parked({ calls, canPickUp }: { calls: Call[]; canPickUp: boolean }) {
  const { engine } = useRuntime();
  const { me } = useShell();
  const { agents } = usePhoneData();
  const { nameFor } = useDirectory();
  const now = useNow(1000);
  return (
    <div className="dock-card dock-parked">
      <p className="dock-parked-title">
        <Icon name="pause" size={14} /> Parked ({calls.length})
      </p>
      <ul className="dock-pick">
        {calls.map((c) => (
          <li key={c.id} className="dock-parked-row">
            <span>
              <strong>{nameFor(otherParty(c))}</strong>
              <span className="muted">
                {" "}
                by {agents.find((a) => a.id === c.parkedBy)?.name ?? "the system"} ·{" "}
                {formatDuration((now - (c.parkedAt ?? now)) / 1000)}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-small"
              disabled={!canPickUp}
              title={canPickUp ? undefined : "Set yourself to Available to pick up"}
              onClick={() => me && engine.unpark(c.id, me.id)}
            >
              Pick up
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WrapUp() {
  const { engine } = useRuntime();
  const { me } = useShell();
  return (
    <div className="dock-card">
      <div className="dock-top">
        <span className="ring-icon ring-icon-still">
          <Icon name="clock" size={18} />
        </span>
        <span className="dock-who">
          <strong>Call ended</strong>
          <span className="muted">Wrap-up: you won&apos;t get calls until you&apos;re ready.</span>
        </span>
      </div>
      <div className="dock-actions">
        <button type="button" className="btn btn-primary" onClick={() => me && engine.setPresence(me.id, "available")}>
          Ready for next call
        </button>
      </div>
    </div>
  );
}
