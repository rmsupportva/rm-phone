"use client";

import { Icon } from "./Icon";

export interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <Icon name={t.tone === "error" ? "alert" : "check"} />
          <span>{t.message}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
