import type { HoursState } from "./types";
import type { ClockTime, HoursSettings, LocalDate } from "./settings";

export interface LocalParts {
  date: LocalDate;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** Minutes since local midnight. */
  minutes: number;
}

export interface HoursDecision {
  state: HoursState;
  /** Plain-words reason, shown in the call timeline and settings screen. */
  label: string;
  local: LocalParts;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** The wall-clock date, weekday and time in `timezone` at instant `now`. */
export function localParts(now: number, timezone: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timezone).formatToParts(new Date(now))) {
    parts[p.type] = p.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS.indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function toMinutes(t: ClockTime): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Is the office open at `now`?
 *
 * Order: holiday beats everything; then the weekly hours; then an early close,
 * which can only move the closing time earlier, never later.
 */
export function evaluateHours(now: number, hours: HoursSettings): HoursDecision {
  const local = localParts(now, hours.timezone);

  const holiday = hours.holidays.find((h) => h.date === local.date);
  if (holiday) return { state: "holiday", label: `Closed: ${holiday.name}`, local };

  const day = hours.weekly[local.weekday];
  if (!day) return { state: "closed", label: "Closed today", local };

  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (local.minutes < open) return { state: "closed", label: `Opens at ${day.open}`, local };
  if (local.minutes >= close) return { state: "closed", label: `Closed at ${day.close}`, local };

  const early = hours.earlyCloses.find((e) => e.date === local.date);
  if (early && toMinutes(early.closeAt) < close && local.minutes >= toMinutes(early.closeAt)) {
    return { state: "early_close", label: `${early.reason}: closed at ${early.closeAt}`, local };
  }

  return { state: "open", label: `Open until ${effectiveClose(local.date, day.close, hours)}`, local };
}

function effectiveClose(date: LocalDate, close: ClockTime, hours: HoursSettings): ClockTime {
  const early = hours.earlyCloses.find((e) => e.date === date);
  return early && toMinutes(early.closeAt) < toMinutes(close) ? early.closeAt : close;
}
