import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children" | "viewBox">;

const base = {
  "aria-hidden": true,
  fill: "currentColor",
  height: "1em",
  viewBox: "0 0 24 24",
  width: "1em",
} as const;

export function FlagIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 21a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h9.1a1 1 0 0 1 .98.8L15.4 5.5H20a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-5.9a1 1 0 0 1-.98-.8L12.8 13.5H6V20a1 1 0 0 1-1 1Z" />
    </svg>
  );
}

export function NoPriorityIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 0 0-6.32 12.9L16.9 5.68A7.96 7.96 0 0 0 12 4Zm6.32 3.1L7.1 18.32A8 8 0 0 0 18.32 7.1Z" />
    </svg>
  );
}

export function PeopleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9.55 17.65 4.3 12.4l1.4-1.4 3.85 3.85 8.75-8.75 1.4 1.4Z" />
    </svg>
  );
}
