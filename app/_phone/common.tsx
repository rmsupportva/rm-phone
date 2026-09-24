"use client";

import type { ReactNode } from "react";
import { initialsOf } from "./format";
import { Icon } from "./Icon";
import { useShell } from "./PhoneContext";

const AVATAR_TONES = ["green", "blue", "amber", "rose", "teal"] as const;

/** Initials in a soft circle; the colour is stable per name. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  return (
    <span
      className={`avatar avatar-${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * List on the left, the open item on the right (Google Voice style). On a
 * phone only one shows at a time and the detail gets a Back button.
 */
export function SplitView({ list, detail, hasSelection }: { list: ReactNode; detail: ReactNode; hasSelection: boolean }) {
  return (
    <div className={`split${hasSelection ? " split-open" : ""}`}>
      <section className="split-list">{list}</section>
      <section className="split-detail">{detail}</section>
    </div>
  );
}

export function PaneHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="pane-head">
      <h2>{title}</h2>
      {actions && <div className="pane-actions">{actions}</div>}
    </header>
  );
}

export function BackButton({ label = "Back" }: { label?: string }) {
  const { select } = useShell();
  return (
    <button type="button" className="btn btn-quiet back-btn" onClick={() => select(null)}>
      <Icon name="back" />
      {label}
    </button>
  );
}

export function EmptyDetail({ icon, title, hint }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; hint: string }) {
  return (
    <div className="empty-detail">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <p className="empty-title">{title}</p>
      <p className="muted">{hint}</p>
    </div>
  );
}

export function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="search">
      <Icon name="search" />
      <span className="visually-hidden">{label}</span>
      <input type="search" placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
