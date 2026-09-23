import type { Call } from "@/lib/phone/types";
import { formatTime, TIMELINE_LABEL } from "./format";

/** Everything that happened to one call, in order. */
export function CallTimeline({ call }: { call: Call }) {
  return (
    <ol className="timeline">
      {call.timeline.map((entry, i) => (
        <li key={i} className={`timeline-item timeline-${entry.kind}`}>
          <time className="timeline-time" dateTime={new Date(entry.at).toISOString()}>
            {formatTime(entry.at)}
          </time>
          <span className="timeline-label">{TIMELINE_LABEL[entry.kind] ?? entry.kind}</span>
          {entry.detail && <span className="timeline-detail">{entry.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
