import type { StatusView } from "./format";
import { Icon } from "./Icon";

/** Status is always icon + words, never colour alone. */
export function StatusBadge({ view }: { view: StatusView }) {
  return (
    <span className={`badge badge-${view.tone}`}>
      <Icon name={view.icon} size={14} />
      {view.label}
    </span>
  );
}
