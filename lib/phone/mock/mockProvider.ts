/**
 * The pretend phone company. It behaves like a real carrier from the call
 * brain's point of view: it announces new calls, reports key presses and
 * hang-ups, records voicemails and conversations, and hands back a
 * transcript. All data it produces is fake.
 */
import type { Clock } from "../clock";
import type { MessagingEvent, MessagingProvider, PhoneProvider, ProviderEvent } from "../provider";
import type { Effect, Lang, TranscriptTurn } from "../types";
import { fakeTranscript, MOCK_LANDLINE, VOICEMAIL_TEXT } from "./fakeData";

interface Line {
  lang: Lang;
  /** When voicemail recording actually starts (after the greeting). */
  recordingFrom?: number;
  maxVoicemailSeconds?: number;
  connectedAt?: number;
  finished: boolean;
}

export interface MockOptions {
  clock: Clock;
  newId: () => string;
  /** Seconds the voicemail greeting plays before recording starts. */
  greetingSeconds: number;
  /** Run something a little later (texts take a moment to deliver). Tests pass an immediate version. */
  defer?: (fn: () => void, ms: number) => void;
}

export class MockProvider implements PhoneProvider, MessagingProvider {
  readonly name = "Pretend phone company";
  private handlers = new Set<(e: ProviderEvent) => void>();
  private messageHandlers = new Set<(e: MessagingEvent) => void>();
  private lines = new Map<string, Line>();

  constructor(private readonly opts: MockOptions) {}

  subscribe(handler: (e: ProviderEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribeMessages(handler: (e: MessagingEvent) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  sendMessage(message: { id: string; to: string; from: string; body: string }): void {
    const defer = this.opts.defer ?? ((fn, ms) => setTimeout(fn, ms));
    defer(() => {
      const event: MessagingEvent =
        message.to === MOCK_LANDLINE
          ? { type: "message_status", id: message.id, status: "failed", error: "Not a mobile number" }
          : { type: "message_status", id: message.id, status: "delivered" };
      this.emitMessage(event);
    }, 900);
  }

  /** Demo control: someone texts the main line. */
  receiveText(from: string, body: string): void {
    this.emitMessage({ type: "message_received", id: this.opts.newId(), from, body });
  }

  private emitMessage(event: MessagingEvent) {
    for (const h of this.messageHandlers) h(event);
  }

  perform(callId: string, effect: Effect): void {
    const line = this.line(callId);
    const now = this.opts.clock.now();
    switch (effect.type) {
      case "play":
        line.lang = effect.lang;
        return;
      case "record_voicemail":
        line.recordingFrom = now + this.opts.greetingSeconds * 1000;
        line.maxVoicemailSeconds = effect.maxSeconds;
        return;
      case "connect":
        line.connectedAt = now;
        return;
      case "hang_up_caller":
      case "hang_up_agent":
      case "release_to_external":
        this.finish(callId, line, now);
        return;
      // Ringing agents' browsers and dialing out need no simulation here:
      // the softphones read ringing from the call itself, and the far end is
      // driven by the demo controls below.
      case "ring":
      case "stop_ringing":
      case "dial":
      case "set_presence":
      case "hold_caller":
      case "unhold_caller":
      case "add_to_call":
      case "remove_from_call":
      case "dial_external":
      case "hang_up_external":
      case "ring_external_for_agent":
      case "dial_agent_cell":
      case "create_callback":
        return;
    }
  }

  /* ---------- Demo controls: things a caller (or the far end) does ---------- */

  placeInboundCall(from: string): string {
    const callId = this.opts.newId();
    this.line(callId);
    this.emit({ type: "incoming_call", callId, from });
    return callId;
  }

  press(callId: string, digit: string): void {
    this.emit({ type: "call_input", callId, input: { type: "caller_pressed", digit } });
  }

  /** The caller hangs up. During voicemail recording, what was said is kept. */
  callerHangsUp(callId: string): void {
    const line = this.line(callId);
    const now = this.opts.clock.now();
    if (line.recordingFrom !== undefined && now >= line.recordingFrom && !line.finished) {
      const seconds = Math.min(
        line.maxVoicemailSeconds ?? Infinity,
        Math.floor((now - line.recordingFrom) / 1000),
      );
      this.saveVoicemail(callId, seconds);
      return;
    }
    this.emit({ type: "call_input", callId, input: { type: "caller_hung_up" } });
  }

  /** Shortcut for the demo: the caller leaves a message of `seconds` right away. */
  leaveMessage(callId: string, seconds: number): void {
    this.saveVoicemail(callId, seconds);
  }

  farEndAnswers(callId: string): void {
    this.line(callId).connectedAt = this.opts.clock.now();
    this.emit({ type: "call_input", callId, input: { type: "far_end_answered" } });
  }

  farEndFails(callId: string): void {
    this.emit({ type: "call_input", callId, input: { type: "far_end_failed" } });
  }

  /** The outside number a call is being transferred to picks up / can't be reached. */
  externalAnswers(callId: string): void {
    this.emit({ type: "call_input", callId, input: { type: "external_answered" } });
  }

  externalFails(callId: string): void {
    this.emit({ type: "call_input", callId, input: { type: "external_failed" } });
  }

  /* ---------- Internals ---------- */

  private saveVoicemail(callId: string, seconds: number) {
    const line = this.line(callId);
    line.recordingFrom = undefined;
    this.emit({
      type: "call_input",
      callId,
      input: {
        type: "voicemail_saved",
        recording: { id: this.opts.newId(), seconds },
        transcript: seconds > 0 ? [{ atSecond: 0, speaker: "caller", text: VOICEMAIL_TEXT[line.lang] }] : undefined,
      },
    });
  }

  private finish(callId: string, line: Line, now: number) {
    if (line.finished) return;
    line.finished = true;
    line.recordingFrom = undefined;
    if (line.connectedAt === undefined) return;
    const seconds = Math.round((now - line.connectedAt) / 1000);
    if (seconds < 1) return;
    const transcript: TranscriptTurn[] = fakeTranscript(line.lang, seconds);
    // A real carrier delivers the recording a little after the call ends.
    queueMicrotask(() =>
      this.emit({
        type: "call_input",
        callId,
        input: {
          type: "recording_ready",
          recording: { id: this.opts.newId(), seconds },
          transcript,
        },
      }),
    );
  }

  private line(callId: string): Line {
    let line = this.lines.get(callId);
    if (!line) {
      line = { lang: "en", finished: false };
      this.lines.set(callId, line);
    }
    return line;
  }

  private emit(event: ProviderEvent) {
    for (const h of this.handlers) h(event);
  }
}
