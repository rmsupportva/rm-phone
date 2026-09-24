"use client";

import { formatDuration, formatPhone, otherParty } from "./format";
import { Avatar } from "./common";
import { Icon } from "./Icon";
import { useDirectory, useNow, usePhoneData, useRuntime, useShell } from "./PhoneContext";

/**
 * The signed-in person's phone, floating over every screen: incoming rings,
 * the call in progress and wrap-up. Like the call window in Google Voice.
 */
export function CallDock() {
  const { calls } = usePhoneData();
  const { me } = useShell();
  if (!me) return null;

  const ringing = calls.filter((c) => c.state === "ringing" && c.ringingAgentIds.includes(me.id));
  const active = calls.find((c) => c.agentId === me.id && (c.state === "answered" || c.state === "dialing"));
  const wrapUp = !active && me.presence === "wrap_up";
  if (!ringing.length && !active && !wrapUp) return null;

  return (
    <aside className="dock" aria-label="Your phone">
      {ringing.map((c) => (
        <Incoming key={c.id} callId={c.id} number={c.from} lang={c.lang} deadline={c.deadline?.at} />
      ))}
      {active && !ringing.length && <Active callId={active.id} />}
      {wrapUp && !ringing.length && <WrapUp />}
    </aside>
  );
}

function Incoming({ callId, number, lang, deadline }: { callId: string; number: string; lang: string; deadline?: number }) {
  const { engine } = useRuntime();
  const { me } = useShell();
  const { nameFor } = useDirectory();
  const now = useNow();
  const left = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  return (
    <div className="dock-card dock-ringing" role="alertdialog" aria-label={`Incoming call from ${nameFor(number)}`}>
      <div className="dock-top">
        <span className="ring-icon">
          <Icon name="bell" size={18} />
        </span>
        <span className="dock-who">
          <strong>{nameFor(number)}</strong>
          <span className="muted">
            Incoming · {lang === "es" ? "Spanish" : "English"} · {left}s
          </span>
        </span>
      </div>
      <div className="dock-actions">
        <button type="button" className="btn btn-success" onClick={() => me && engine.answer(callId, me.id)}>
          Answer
        </button>
        <button type="button" className="btn" onClick={() => me && engine.decline(callId, me.id)}>
          Decline
        </button>
      </div>
    </div>
  );
}

function Active({ callId }: { callId: string }) {
  const { calls } = usePhoneData();
  const { engine, provider } = useRuntime();
  const { me, navigate } = useShell();
  const { nameFor, contactFor } = useDirectory();
  const now = useNow();
  const call = calls.find((c) => c.id === callId);
  if (!call || !me) return null;
  const number = otherParty(call);
  const talking = call.state === "answered" && call.answeredAt !== undefined;
  const contact = contactFor(number);

  return (
    <div className="dock-card">
      <div className="dock-top">
        <Avatar name={nameFor(number)} size={40} />
        <span className="dock-who">
          <strong>{nameFor(number)}</strong>
          <span className="muted">{contact ? formatPhone(number) : talking ? "On a call" : "Calling…"}</span>
        </span>
        <span className="dock-clock" aria-live="off">
          {talking ? formatDuration((now - call.answeredAt!) / 1000) : "Ringing"}
        </span>
      </div>
      <div className="dock-actions">
        <button type="button" className="btn btn-danger" onClick={() => engine.hangUp(call.id, me.id)}>
          {talking ? "Hang up" : "Cancel"}
        </button>
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
          <button type="button" className="link-btn" onClick={() => provider.callerHangsUp(call.id)}>
            They hang up
          </button>
        </div>
      )}
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
