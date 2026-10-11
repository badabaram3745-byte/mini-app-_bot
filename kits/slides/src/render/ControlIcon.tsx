import type { ReactNode } from "react";

type ControlIconName =
  | "close"
  | "download"
  | "file-pdf"
  | "file-pptx"
  | "fullscreen"
  | "grid"
  | "next"
  | "panel-left-close"
  | "panel-left-open"
  | "play"
  | "presenter"
  | "previous";

const iconContents: Record<ControlIconName, ReactNode> = {
  close: <path d="M6 6l8 8M14 6l-8 8" />,
  download: <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 16h12" />,
  "file-pdf": (
    <>
      <path d="M5 2.5h6l4 4v11H5v-15Z" />
      <path d="M11 2.5v4h4M7.5 10.5h5M7.5 13.5h4" />
    </>
  ),
  "file-pptx": (
    <>
      <rect x="3" y="3" width="14" height="11" rx="2" />
      <path d="M10 5.2v3.3h3.3M10 5.2a3.3 3.3 0 1 0 3.3 3.3M7 17h6M10 14v3" />
    </>
  ),
  fullscreen: <path d="M8 8 4 4m0 0v3m0-3h3M12 12l4 4m0 0v-3m0 3h-3" />,
  grid: (
    <>
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="12" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="12" width="5" height="5" rx="1" />
      <rect x="12" y="12" width="5" height="5" rx="1" />
    </>
  ),
  next: <path d="M7.5 5l5 5-5 5" />,
  "panel-left-close": panelLeftIcon({ sidebarVisible: true }),
  "panel-left-open": panelLeftIcon({ sidebarVisible: false }),
  play: <path d="M7 5.5v9l7-4.5-7-4.5Z" />,
  presenter: (
    <>
      <rect x="3" y="4" width="14" height="10" rx="2" />
      <path d="M7 17h6M10 14v3" />
    </>
  ),
  previous: <path d="M12.5 5 7.5 10l5 5" />,
};

function panelLeftIcon({ sidebarVisible }: { sidebarVisible: boolean }) {
  return (
    <>
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d="M7 3v14" />
      <path
        data-panel-fill=""
        d="M4.5 3H7v14H4.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        fill="currentColor"
        fillOpacity={sidebarVisible ? 1 : 0}
        stroke="none"
      />
    </>
  );
}

export function ControlIcon({ name }: { name: ControlIconName }) {
  return (
    <svg viewBox="0 0 20 20" data-icon={name} aria-hidden="true">
      {iconContents[name]}
    </svg>
  );
}
