"use client";

import { DEMO_SETTINGS, PROMPTS } from "@/lib/phone/settings";
import type { PromptId } from "@/lib/phone/types";
import { formatPhone, PRESENCE_VIEW } from "./format";
import { usePhoneData } from "./PhoneContext";
import { StatusBadge } from "./StatusBadge";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PROMPT_LABEL: Record<PromptId, string> = {
  welcome_language: "Welcome and language",
  main_menu: "Main menu",
  closed: "Closed",
  holiday: "Holiday",
  early_close: "Closed early",
  all_busy: "Everyone busy",
  voicemail_greeting: "Voicemail greeting",
  please_hold: "Please hold",
  callback_offer: "Callback offer (nobody free)",
  callback_confirmed: "Callback confirmed",
  no_agents: "Nobody available (goodbye)",
};

const longDate = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const showDate = (d: string) => longDate.format(Date.parse(`${d}T12:00:00Z`));

export function SettingsView() {
  const { agents } = usePhoneData();
  const s = DEMO_SETTINGS;

  return (
    <div className="settings-grid">
      <p className="notice settings-notice">
        These are the settings the demo runs on. Editing them from this screen comes in a later step.
      </p>

      <section className="panel" aria-labelledby="hours-title">
        <div className="panel-head">
          <h2 id="hours-title">Office hours</h2>
          <p className="panel-sub">Time zone: {s.hours.timezone.replace("_", " ")}</p>
        </div>
        <table className="table table-compact">
          <tbody>
            {DAYS.map((d, i) => {
              const h = s.hours.weekly[i];
              return (
                <tr key={d}>
                  <th scope="row">{d}</th>
                  <td>{h ? `${h.open} – ${h.close}` : <span className="muted">Closed</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel" aria-labelledby="holidays-title">
        <div className="panel-head">
          <h2 id="holidays-title">Holidays</h2>
          <p className="panel-sub">Closed all day. Callers go straight to voicemail.</p>
        </div>
        <ul className="plain-list">
          {s.hours.holidays.map((h) => (
            <li key={h.date}>
              <span>{showDate(h.date)}</span>
              <span className="muted">{h.name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="early-title">
        <div className="panel-head">
          <h2 id="early-title">Early closes</h2>
          <p className="panel-sub">
            Candle lighting on winter Fridays. Sample times (approximate); the real build loads them from Hebcal. An
            early close can only shorten a day.
          </p>
        </div>
        <ul className="plain-list">
          {s.hours.earlyCloses.map((e) => (
            <li key={e.date}>
              <span>{showDate(e.date)}</span>
              <span className="muted">
                {e.reason} · closes {e.closeAt}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="queue-title">
        <div className="panel-head">
          <h2 id="queue-title">Ringing</h2>
          <p className="panel-sub">Main line {formatPhone(s.mainNumber)}</p>
        </div>
        <dl className="facts facts-stack">
          <div>
            <dt>Queue</dt>
            <dd>{s.queue.name}</dd>
          </div>
          <div>
            <dt>How it rings</dt>
            <dd>Every available VA at once, for {s.queue.ringSeconds} seconds, then voicemail</dd>
          </div>
          <div>
            <dt>Menu wait</dt>
            <dd>{s.menuSeconds} seconds per step (no key: English, then ring the team)</dd>
          </div>
          <div>
            <dt>Longest voicemail</dt>
            <dd>{s.voicemailMaxSeconds} seconds</dd>
          </div>
          <div>
            <dt>Outgoing calls</dt>
            <dd>Give up after {s.dialSeconds} seconds with no answer</dd>
          </div>
        </dl>
        <h3 className="section-title">Members</h3>
        <ul className="plain-list">
          {agents.map((a) => (
            <li key={a.id}>
              <span>
                {a.name}
                {a.speaksSpanish && <span className="tag">ES</span>}
              </span>
              <StatusBadge view={PRESENCE_VIEW[a.presence]} />
            </li>
          ))}
        </ul>
      </section>

      <section className="panel panel-span" aria-labelledby="prompts-title">
        <div className="panel-head">
          <h2 id="prompts-title">What callers hear</h2>
          <p className="panel-sub">Text for now; the real build plays recorded audio.</p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Message</th>
                <th scope="col">English</th>
                <th scope="col">Español</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PROMPTS) as PromptId[]).map((id) => (
                <tr key={id}>
                  <th scope="row">{PROMPT_LABEL[id]}</th>
                  <td lang="en">{PROMPTS[id].en}</td>
                  <td lang="es">{PROMPTS[id].es}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
