import type { Lang, PromptId } from "./types";

/** "HH:MM" on a 24-hour clock, in the workspace time zone. */
export type ClockTime = string;
/** "YYYY-MM-DD" in the workspace time zone. */
export type LocalDate = string;

export interface DayHours {
  open: ClockTime;
  close: ClockTime;
}

export interface HoursSettings {
  timezone: string;
  /** Index 0 = Sunday … 6 = Saturday. `null` = closed all day. */
  weekly: (DayHours | null)[];
  holidays: { date: LocalDate; name: string }[];
  /** A day that closes early. Can only make a day shorter, never longer. */
  earlyCloses: { date: LocalDate; closeAt: ClockTime; reason: string }[];
}

export interface QueueSettings {
  id: string;
  name: string;
  /** How long every available agent rings before the caller goes to voicemail. */
  ringSeconds: number;
}

export interface PhoneSettings {
  mainNumber: string;
  hours: HoursSettings;
  queue: QueueSettings;
  /** Seconds to wait for a key press at each menu step. */
  menuSeconds: number;
  /** Longest voicemail a caller can leave. */
  voicemailMaxSeconds: number;
  /** Time allowed for the greeting to play before recording starts. */
  voicemailGreetingSeconds: number;
  /** Outbound: how long to wait for the other side to pick up. */
  dialSeconds: number;
  /** Safety cap on any single conversation. */
  maxCallSeconds: number;
  /** How long a transfer target rings before the transfer is called off. */
  transferSeconds: number;
  /** How long someone being added to a call (e.g. a VA) rings. */
  inviteSeconds: number;
  /** Call VA: how long the agent's own VA rings before every VA is rung. */
  inviteFirstSeconds: number;
  /** How long a call stays parked before the whole team is rung. */
  parkSeconds: number;
}

const weekday: DayHours = { open: "09:00", close: "17:00" };

/**
 * Demo settings. Hours match the live business (weekdays 9–5, closed on
 * Shabbat and Yom Tov). Candle-lighting times below are APPROXIMATE sample
 * values for Monroe, NY; the real build loads them from Hebcal.
 */
export const DEMO_SETTINGS: PhoneSettings = {
  mainNumber: "+18455550100",
  hours: {
    timezone: "America/New_York",
    weekly: [null, weekday, weekday, weekday, weekday, weekday, null],
    holidays: [
      { date: "2026-09-26", name: "Sukkot" },
      { date: "2026-09-27", name: "Sukkot" },
      { date: "2026-09-28", name: "Chol HaMoed Sukkot" },
      { date: "2026-09-29", name: "Chol HaMoed Sukkot" },
      { date: "2026-09-30", name: "Chol HaMoed Sukkot" },
      { date: "2026-10-01", name: "Chol HaMoed Sukkot" },
      { date: "2026-10-02", name: "Hoshana Rabbah" },
      { date: "2026-10-03", name: "Shemini Atzeret" },
      { date: "2026-10-04", name: "Simchat Torah" },
    ],
    earlyCloses: [
      { date: "2026-11-06", closeAt: "16:34", reason: "Candle lighting" },
      { date: "2026-11-13", closeAt: "16:27", reason: "Candle lighting" },
      { date: "2026-11-20", closeAt: "16:21", reason: "Candle lighting" },
      { date: "2026-11-27", closeAt: "16:17", reason: "Candle lighting" },
      { date: "2026-12-04", closeAt: "16:14", reason: "Candle lighting" },
      { date: "2026-12-11", closeAt: "16:13", reason: "Candle lighting" },
      { date: "2026-12-18", closeAt: "16:14", reason: "Candle lighting" },
      { date: "2026-12-25", closeAt: "16:17", reason: "Candle lighting" },
    ],
  },
  queue: { id: "screening", name: "Screening queue", ringSeconds: 30 },
  menuSeconds: 15,
  voicemailMaxSeconds: 120,
  voicemailGreetingSeconds: 10,
  dialSeconds: 45,
  maxCallSeconds: 4 * 60 * 60,
  transferSeconds: 25,
  inviteSeconds: 18,
  inviteFirstSeconds: 8,
  parkSeconds: 5 * 60,
};

/** What the caller hears. The real build swaps these for recorded audio. */
export const PROMPTS: Record<PromptId, Record<Lang, string>> = {
  welcome_language: {
    en: "Thank you for calling RM Support. For English, press 1. Para español, oprima 2.",
    es: "Gracias por llamar a RM Support. For English, press 1. Para español, oprima 2.",
  },
  main_menu: {
    en: "To speak with someone, press 1. To leave a message, press 2.",
    es: "Para hablar con alguien, oprima 1. Para dejar un mensaje, oprima 2.",
  },
  closed: {
    en: "Our office is closed. Our hours are Monday to Friday, 9 to 5.",
    es: "Nuestra oficina está cerrada. Nuestro horario es de lunes a viernes, de 9 a 5.",
  },
  holiday: {
    en: "Our office is closed today for the holiday.",
    es: "Nuestra oficina está cerrada hoy por el día festivo.",
  },
  early_close: {
    en: "Our office has closed early today.",
    es: "Nuestra oficina cerró temprano hoy.",
  },
  all_busy: {
    en: "Everyone is busy helping other callers.",
    es: "Todos están ocupados ayudando a otras personas.",
  },
  voicemail_greeting: {
    en: "Please leave your name, number and a short message after the tone.",
    es: "Por favor deje su nombre, número y un breve mensaje después del tono.",
  },
  please_hold: {
    en: "Please hold while we connect you.",
    es: "Por favor espere mientras le conectamos.",
  },
};
