import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P & { children: ReactNode }) {
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
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: P) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M7 4.6v14.8a1 1 0 0 0 1.52.86l12.2-7.4a1 1 0 0 0 0-1.72L8.52 3.74A1 1 0 0 0 7 4.6Z" />
  </Svg>
);
export const PauseIcon = (p: P) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="6" y="4" width="4.2" height="16" rx="1.2" />
    <rect x="13.8" y="4" width="4.2" height="16" rx="1.2" />
  </Svg>
);
export const Back10Icon = (p: P) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <text x="12.2" y="15.6" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text>
  </Svg>
);
export const Fwd10Icon = (p: P) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <text x="11.8" y="15.6" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text>
  </Svg>
);
export const VolumeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </Svg>
);
export const MuteIcon = (p: P) => (
  <Svg {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" />
    <path d="m22 9-6 6M16 9l6 6" />
  </Svg>
);
export const ExpandIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </Svg>
);
export const ShrinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
  </Svg>
);
export const ArrowLeftIcon = (p: P) => (
  <Svg {...p}>
    <path d="m12 19-7-7 7-7M19 12H5" />
  </Svg>
);
export const ArrowRightIcon = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </Svg>
);
export const CopyIcon = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
export const TrashIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </Svg>
);
export const SendIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 21.5a.5.5 0 0 0 .93-.06l6.5-19a.5.5 0 0 0-.63-.63l-19 6.5a.5.5 0 0 0-.06.93l7.93 3.18a2 2 0 0 1 1.11 1.11zM21.85 2.15 10.9 13.1" />
  </Svg>
);
export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Svg>
);
export const FilmIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <path d="m10 9 5 3-5 3V9Z" />
  </Svg>
);
export const YouTubeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.6 49.6 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.6 49.6 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
    <path d="m10 15 5-3-5-3z" fill="currentColor" />
  </Svg>
);
export const SparkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
  </Svg>
);
export const UsersIcon = (p: P) => (
  <Svg {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);
export const LogoMark = ({ size = 28 }: { size?: number }) => (
  <span
    className="grid shrink-0 place-items-center rounded-[9px] shadow-[0_6px_18px_rgb(124_58_237/0.35)]"
    style={{ width: size, height: size, background: "linear-gradient(135deg, #a78bfa, #7c3aed)" }}
  >
    <PlayIcon size={size * 0.46} className="ml-px text-white" />
  </span>
);
export const Wordmark = ({ size = 28 }: { size?: number }) => (
  <span className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
    <LogoMark size={size} />
    <span>
      Watch<span className="text-accent">Party</span>
    </span>
  </span>
);
