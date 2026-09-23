import type { IconName } from "./format";

/** Small stroke icons. Decorative: every icon sits next to a text label. */
const PATHS: Record<IconName, string> = {
  phone:
    "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  incoming:
    "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2 M21 3l-6 6 M15 4v5h5",
  outgoing:
    "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2 M15 9l6-6 M16 3h5v5",
  missed:
    "M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2 M15 3l6 6 M21 3l-6 6",
  voicemail: "M6.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M17.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M6.5 16h11",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12 M18 6L6 18",
  menu: "M5 5h3v3H5z M10.5 5h3v3h-3z M16 5h3v3h-3z M5 10.5h3v3H5z M10.5 10.5h3v3h-3z M16 10.5h3v3h-3z M10.5 16h3v3h-3z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z M10 20.5a2 2 0 0 0 4 0",
  talk: "M4 5h16v10H9l-5 4z M8 9h8 M8 12h5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5l3 2",
  pause: "M9 6v12 M15 6v12",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="icon"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
