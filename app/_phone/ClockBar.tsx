"use client";

import { evaluateHours } from "@/lib/phone/hours";
import { DEMO_SETTINGS } from "@/lib/phone/settings";
import { formatDateTime } from "./format";
import { Icon } from "./Icon";
import { useNow, useRuntime } from "./PhoneContext";

const PRESETS: { label: string; iso: string }[] = [
  { label: "Weekday 11:00 (open)", iso: "2026-09-22T11:00:00-04:00" },
  { label: "Weekday 16:59 (about to close)", iso: "2026-09-22T16:59:30-04:00" },
  { label: "Weekday 19:00 (closed)", iso: "2026-09-22T19:00:00-04:00" },
  { label: "Sukkot (holiday)", iso: "2026-09-28T11:00:00-04:00" },
  { label: "Winter Friday 16:05 (closes 16:13)", iso: "2026-12-11T16:05:00-05:00" },
  { label: "Winter Friday 16:30 (after candle lighting)", iso: "2026-12-11T16:30:00-05:00" },
];

const SPEEDS = [1, 5, 20];

export function ClockBar({ onReset }: { onReset: () => void }) {
  const { clock } = useRuntime();
  const now = useNow(500);
  const hours = evaluateHours(now, DEMO_SETTINGS.hours);
  const open = hours.state === "open";

  return (
    <section className="clockbar" aria-label="Demo clock">
      <div className="clockbar-now">
        <Icon name="clock" />
        <span>
          <span className="muted">Demo time (New York): </span>
          <strong>{formatDateTime(now)}</strong>
        </span>
        <span className={`badge badge-${open ? "success" : "danger"}`}>
          <Icon name={open ? "check" : "moon"} size={14} />
          {hours.label}
        </span>
      </div>
      <div className="clockbar-controls">
        <label className="field-inline">
          <span className="muted">Jump to</span>
          <select
            className="select"
            value=""
            onChange={(e) => {
              if (e.target.value === "now") clock.setTime(Date.now());
              else if (e.target.value) clock.setTime(Date.parse(e.target.value));
            }}
          >
            <option value="">Choose a moment…</option>
            <option value="now">Right now (real time)</option>
            {PRESETS.map((p) => (
              <option key={p.iso} value={p.iso}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="group" aria-label="Clock speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={clock.speed === s}
              onClick={() => clock.setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-quiet" onClick={onReset}>
          Reset demo
        </button>
      </div>
    </section>
  );
}
