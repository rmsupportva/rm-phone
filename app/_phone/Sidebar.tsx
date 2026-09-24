"use client";

import { needsCallback } from "@/lib/phone/callMachine";
import { listConversations } from "@/lib/phone/messaging";
import type { IconName } from "./format";
import { PRESENCE_VIEW } from "./format";
import { Icon } from "./Icon";
import { usePhoneData, useShell, type Section } from "./PhoneContext";

interface Item {
  id: Section;
  label: string;
  icon: IconName;
  count?: number;
  countLabel?: string;
}

export function Sidebar() {
  const { calls, messages, reads, optOuts } = usePhoneData();
  const { section, navigate } = useShell();

  const unreadTexts = listConversations(messages, reads, optOuts).reduce((n, c) => n + c.unread, 0);
  const unheard = calls.filter((c) => c.voicemail && !c.heardAt).length;
  const toReturn = calls.filter((c) => needsCallback(c) && c.endReason !== "voicemail").length;

  const main: Item[] = [
    { id: "calls", label: "Calls", icon: "phone", count: toReturn, countLabel: "missed" },
    { id: "messages", label: "Messages", icon: "message", count: unreadTexts, countLabel: "unread" },
    { id: "voicemail", label: "Voicemail", icon: "voicemail", count: unheard, countLabel: "new" },
    { id: "contacts", label: "Contacts", icon: "contacts" },
  ];
  const extra: Item[] = [
    { id: "team", label: "Team & demo", icon: "team" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];

  const link = (item: Item) => (
    <li key={item.id}>
      <button
        type="button"
        className="nav-item"
        aria-current={section === item.id ? "page" : undefined}
        onClick={() => navigate(item.id)}
      >
        <Icon name={item.icon} size={20} />
        <span className="nav-label">{item.label}</span>
        {item.count ? (
          <span className="nav-count">
            {item.count}
            <span className="visually-hidden"> {item.countLabel}</span>
          </span>
        ) : null}
      </button>
    </li>
  );

  return (
    <nav className="sidebar" aria-label="Phone">
      <ul className="nav-list">{main.map(link)}</ul>
      <ul className="nav-list nav-list-extra">{extra.map(link)}</ul>
      <MeSelect id="me-select" />
    </nav>
  );
}

/** Demo only: which team member you are using the app as. */
export function MeSelect({ id }: { id: string }) {
  const { agents } = usePhoneData();
  const { me, setMe } = useShell();
  return (
    <div className="me">
      <label className="me-label" htmlFor={id}>
        Using the app as
      </label>
      <select id={id} className="select" value={me?.id ?? ""} onChange={(e) => setMe(e.target.value)}>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {PRESENCE_VIEW[a.presence].label}
          </option>
        ))}
      </select>
    </div>
  );
}
