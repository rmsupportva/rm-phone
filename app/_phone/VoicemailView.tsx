"use client";

import { useEffect } from "react";
import { CallDetail } from "./CallsView";
import { formatDuration, formatListTime, otherParty } from "./format";
import { Avatar, EmptyDetail, PaneHeader, SplitView } from "./common";
import { useDirectory, useNow, usePhoneData, useRuntime, useShell } from "./PhoneContext";

export function VoicemailView() {
  const { calls } = usePhoneData();
  const { selection } = useShell();
  const { engine } = useRuntime();
  const open = calls.find((c) => c.id === selection && c.voicemail);

  // Opening a voicemail marks it heard.
  useEffect(() => {
    if (open && !open.heardAt) engine.markVoicemailHeard(open.id);
  }, [engine, open]);

  return (
    <SplitView
      hasSelection={selection !== null}
      list={<VoicemailList />}
      detail={
        open ? (
          <CallDetail call={open} />
        ) : (
          <EmptyDetail icon="voicemail" title="Pick a voicemail" hint="Read what they said and call them back." />
        )
      }
    />
  );
}

function VoicemailList() {
  const { calls } = usePhoneData();
  const { selection, select } = useShell();
  const { nameFor } = useDirectory();
  const now = useNow(30_000);
  const voicemails = calls.filter((c) => c.voicemail);

  return (
    <>
      <PaneHeader title="Voicemail" />
      {voicemails.length === 0 ? (
        <p className="empty">No voicemails.</p>
      ) : (
        <ul className="rows" aria-label="Voicemails">
          {voicemails.map((c) => {
            const unheard = !c.heardAt;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className={`row${unheard ? " row-unread" : ""}`}
                  aria-current={selection === c.id ? "true" : undefined}
                  onClick={() => select(c.id)}
                >
                  <Avatar name={nameFor(otherParty(c))} />
                  <span className="row-main">
                    <span className="row-top">
                      <span className="row-title">{nameFor(otherParty(c))}</span>
                      <span className="row-time">{formatListTime(c.startedAt, now)}</span>
                    </span>
                    <span className="row-sub">
                      {formatDuration(c.voicemail!.seconds)}
                      {c.transcript?.[0] && ` · ${c.transcript[0].text}`}
                    </span>
                  </span>
                  {unheard && (
                    <span className="unread-dot">
                      <span className="visually-hidden">New</span>
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
