"use client";

import { useState } from "react";
import { CallerPanel } from "./CallerPanel";
import { CallTimeline } from "./CallTimeline";
import { callStatus, formatTime, otherParty } from "./format";
import { Icon } from "./Icon";
import { useDirectory, usePhoneData } from "./PhoneContext";
import { StatusBadge } from "./StatusBadge";
import { TeamPanel } from "./TeamPanel";

export function LiveView() {
  return (
    <div className="live-grid">
      <CallerPanel />
      <TeamPanel />
      <ActivityPanel />
    </div>
  );
}

function ActivityPanel() {
  const { calls } = usePhoneData();
  const { nameFor } = useDirectory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const recent = calls.slice(0, 8);
  const selected = recent.find((c) => c.id === selectedId) ?? recent[0];

  return (
    <section className="panel" aria-labelledby="activity-title">
      <div className="panel-head">
        <h2 id="activity-title">What happened</h2>
        <p className="panel-sub">Every step of a call, as the system saw it.</p>
      </div>
      {recent.length === 0 ? (
        <p className="empty">No calls yet. Place one from the left.</p>
      ) : (
        <>
          <ul className="call-picker" aria-label="Recent calls">
            {recent.map((c) => {
              const who = nameFor(otherParty(c));
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="call-pick"
                    aria-pressed={c.id === selected?.id}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <Icon name={c.direction === "inbound" ? "incoming" : "outgoing"} size={14} />
                    <span className="call-pick-who">{who}</span>
                    <span className="muted">{formatTime(c.startedAt)}</span>
                    <StatusBadge view={callStatus(c)} />
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && <CallTimeline call={selected} />}
        </>
      )}
    </section>
  );
}
