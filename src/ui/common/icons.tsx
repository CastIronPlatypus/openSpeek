import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
}

function Svg({ size = 20, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const solid = { fill: 'currentColor', stroke: 'none' } as const;

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path {...solid} d="M8 5.2v13.6a1 1 0 0 0 1.52.85l10.9-6.8a1 1 0 0 0 0-1.7L9.52 4.35A1 1 0 0 0 8 5.2z" />
  </Svg>
);
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect {...solid} x="6" y="4.5" width="4.2" height="15" rx="1.2" />
    <rect {...solid} x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
  </Svg>
);
export const PrevIcon = (p: IconProps) => (
  <Svg {...p}>
    <path {...solid} d="M18 6.3v11.4a.9.9 0 0 1-1.38.76L8.6 13.3a1.5 1.5 0 0 1 0-2.6l8.02-5.16A.9.9 0 0 1 18 6.3z" />
    <rect {...solid} x="5" y="5.5" width="2.3" height="13" rx="1" />
  </Svg>
);
export const NextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path {...solid} d="M6 6.3v11.4a.9.9 0 0 0 1.38.76l8.02-5.16a1.5 1.5 0 0 0 0-2.6L7.38 5.54A.9.9 0 0 0 6 6.3z" />
    <rect {...solid} x="16.7" y="5.5" width="2.3" height="13" rx="1" />
  </Svg>
);
export const ReplayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path d="M4 4v4.5h4.5" />
  </Svg>
);
export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.54V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.54-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.1a1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.54 1z" />
  </Svg>
);
export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </Svg>
);
export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Svg>
);
export const SystemThemeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path {...solid} d="M12 3.5a8.5 8.5 0 0 1 0 17z" />
  </Svg>
);
export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle {...solid} cx="5.5" cy="12" r="1.8" />
    <circle {...solid} cx="12" cy="12" r="1.8" />
    <circle {...solid} cx="18.5" cy="12" r="1.8" />
  </Svg>
);
export const VoiceIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M18 7.5a4 4 0 0 1 0 5M20.5 5a7.5 7.5 0 0 1 0 10" />
  </Svg>
);
export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </Svg>
);
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7" />
  </Svg>
);
export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 5.5l4 4M4 20l1-4.5L15.8 4.7a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L8.5 19 4 20z" />
  </Svg>
);
export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 16V5M7 9.5l5-5 5 5M5 20h14" />
  </Svg>
);
export const TextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 6h14M5 10.5h14M5 15h9M5 19.5h6" />
  </Svg>
);
export const PasteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2" />
    <rect x="9" y="3" width="6" height="3" rx="1" />
    <path d="M9 11h6M9 15h4" />
  </Svg>
);
export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const KeyboardIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14.2h8" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </Svg>
);
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.3-4.3" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const LocateIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const ContentsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5h.01M4 12h.01M4 17.5h.01M8 6.5h12M11 12h9M11 17.5h9" />
  </Svg>
);
/** Up to the previous section (chevron with a bar). */
export const PrevSectionIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6h12M7 15.5l5-5 5 5" />
  </Svg>
);
export const NextSectionIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 18h12M7 8.5l5 5 5-5" />
  </Svg>
);
export const ChevronUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 14.5l5-5 5 5" />
  </Svg>
);

/** The app mark: an open page with sound waves rising from it. */
export const LogoMark = ({ size = 28 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="8" fill="var(--accent)" />
    <path
      d="M7 22.5c3-1.4 6-1.4 9 .6 3-2 6-2 9-.6"
      fill="none"
      stroke="var(--on-accent)"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <path
      d="M11 17.5v-4M16 18.5v-9M21 17.5v-4"
      fill="none"
      stroke="var(--on-accent)"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);
