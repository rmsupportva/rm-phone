"use client";

import { useState } from "react";
import { DEMO_CALLERS } from "@/lib/phone/mock/fakeData";
import { DEMO_SETTINGS, PROMPTS } from "@/lib/phone/settings";
import type { Call, PromptId } from "@/lib/phone/types";
import { callStatus, formatDuration, formatPhone, otherParty } from "./format";
import { Icon } from "./Icon";
import { useDirectory, useNow, usePhoneData, useRuntime, useShell } from "./PhoneContext";
import { StatusBadge } from "./StatusBadge";

const TEXTS_IN = ["Hi, is this RM Support?", "Can someone call me back?", "Hola, necesito ayuda con mi solicitud."];

/** The pretend phone company's controls: be the caller (or the person being called). */
export function CallerPanel() {
  const { provider } = useRuntime();
  const { calls } = usePhoneData();
  const { navigate, toast } = useShell();
  const { nameFor } = useDirectory();
  const [caller, setCaller] = useState(DEMO_CALLERS[0]);
  const [textSeq, setTextSeq] = useState(0);
  const live = calls.filter((c) => c.state !== "ended");

  const textIn = () => {
    provider.receiveText(caller, TEXTS_IN[textSeq % TEXTS_IN.length]);
    setTextSeq((n) => n + 1);
    toast(`${nameFor(caller)} texted the main line.`);
  };

  return (
    <section className="panel" aria-labelledby="callers-title">
      <div className="panel-head">
        <h2 id="callers-title">Callers</h2>
        <p className="panel-sub">
          You play the pretend phone company: call in, press keys, hang up.
        </p>
      </div>

      <div className="place-call">
        <fieldset className="chips">
          <legend className="field-label">Be this person</legend>
          {DEMO_CALLERS.map((number) => (
            <label key={number} className="chip">
              <input
                type="radio"
                name="caller"
                value={number}
                checked={caller === number}
                onChange={() => setCaller(number)}
              />
              <span>{nameFor(number)}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" className="btn btn-primary btn-block" onClick={() => provider.placeInboundCall(caller)}>
          <Icon name="phone" />
          Call the main line {formatPhone(DEMO_SETTINGS.mainNumber)}
        </button>
        <div className="place-call-row">
          <button type="button" className="btn btn-block" onClick={textIn}>
            <Icon name="message" />
            Text the main line
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => navigate("messages", caller)}>
            Open thread
          </button>
        </div>
      </div>

      <h3 className="section-title">On the line now</h3>
      {live.length === 0 ? (
        <p className="empty">Nobody is on the phone.</p>
      ) : (
        <ul className="line-list">
          {live.map((c) => (
            <li key={c.id}>
              <LineCard call={c} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LineCard({ call }: { call: Call }) {
  const { provider } = useRuntime();
  const { agents } = usePhoneData();
  const now = useNow();
  const { nameFor } = useDirectory();
  const who = nameFor(otherParty(call));
  const secondsLeft = call.deadline ? Math.max(0, Math.ceil((call.deadline.at - now) / 1000)) : 0;
  const agentName = agents.find((a) => a.id === call.agentId)?.name;

  return (
    <article className="line-card" aria-label={`${who}, ${callStatus(call).label}`}>
      <header className="line-card-head">
        <span className="line-who">
          <Icon name={call.direction === "inbound" ? "incoming" : "outgoing"} />
          <strong>{who}</strong>
          <span className="muted">{formatPhone(otherParty(call))}</span>
        </span>
        <StatusBadge view={callStatus(call)} />
      </header>

      {call.direction === "outbound" ? (
        <p className="line-note">
          {agentName} is calling this number. You are the person being called.
        </p>
      ) : (
        <Hears call={call} now={now} />
      )}

      <div className="line-actions">
        {call.state === "menu" && call.menuStep === "language" && (
          <>
            <button type="button" className="btn" onClick={() => provider.press(call.id, "1")}>
              <kbd>1</kbd> English
            </button>
            <button type="button" className="btn" onClick={() => provider.press(call.id, "2")}>
              <kbd>2</kbd> Español
            </button>
          </>
        )}
        {call.state === "menu" && call.menuStep === "main" && (
          <>
            <button type="button" className="btn" onClick={() => provider.press(call.id, "1")}>
              <kbd>1</kbd> Speak with someone
            </button>
            <button type="button" className="btn" onClick={() => provider.press(call.id, "2")}>
              <kbd>2</kbd> Leave a message
            </button>
          </>
        )}
        {call.state === "voicemail" && (
          <button type="button" className="btn" onClick={() => provider.leaveMessage(call.id, 10)}>
            <Icon name="voicemail" />
            Leave a 10-second message
          </button>
        )}
        {call.state === "dialing" && (
          <>
            <button type="button" className="btn btn-success" onClick={() => provider.farEndAnswers(call.id)}>
              Pick up
            </button>
            <button type="button" className="btn" onClick={() => provider.callerHangsUp(call.id)}>
              Reject
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => provider.farEndFails(call.id)}>
              Line fails
            </button>
          </>
        )}
        {call.state !== "dialing" && (
          <button type="button" className="btn btn-danger-quiet" onClick={() => provider.callerHangsUp(call.id)}>
            Hang up
          </button>
        )}
      </div>

      <p className="line-meta muted">
        {call.state === "answered" && call.answeredAt !== undefined && (
          <>Talking for {formatDuration((now - call.answeredAt) / 1000)}</>
        )}
        {call.state === "ringing" && <>Ringing {call.ringingAgentIds.length} · voicemail in {secondsLeft}s</>}
        {call.state === "menu" && <>No key in {secondsLeft}s → {call.menuStep === "language" ? "English" : "ring the team"}</>}
        {call.state === "dialing" && <>No answer in {secondsLeft}s</>}
      </p>
    </article>
  );
}

/** What the caller is hearing right now. */
function Hears({ call, now }: { call: Call; now: number }) {
  let prompt: PromptId | null = null;
  let extra: string | null = null;

  if (call.state === "menu") {
    prompt = call.menuStep === "language" ? "welcome_language" : "main_menu";
  } else if (call.state === "ringing") {
    prompt = "please_hold";
  } else if (call.state === "answered") {
    extra = "Talking with the team.";
  } else if (call.state === "voicemail") {
    const enteredAt = [...call.timeline].reverse().find((t) => t.kind === "voicemail")?.at ?? now;
    const recordFrom = enteredAt + DEMO_SETTINGS.voicemailGreetingSeconds * 1000;
    prompt = "voicemail_greeting";
    extra =
      now < recordFrom
        ? `Greeting playing. Recording starts in ${Math.ceil((recordFrom - now) / 1000)}s; hanging up now leaves no message.`
        : `Recording: ${formatDuration((now - recordFrom) / 1000)}. Hanging up saves the message.`;
  }

  return (
    <div className="hears">
      <span className="hears-label">Hears</span>
      {prompt && <q lang={call.lang}>{PROMPTS[prompt][call.lang]}</q>}
      {extra && <span className="hears-extra">{extra}</span>}
    </div>
  );
}
