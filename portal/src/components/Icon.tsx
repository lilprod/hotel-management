import type { ReactNode } from 'react';

/** Line icons (24px grid, 1.5px stroke, currentColor). Decorative: always aria-hidden. */
const PATHS: Record<string, ReactNode> = {
  pool: (
    <>
      <path d="M8 4v10M16 4v10M8 7h8M8 11h8" />
      <path d="M3 17c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1" />
      <path d="M3 21c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0" />
      <circle cx="12" cy="19.2" r="1" />
    </>
  ),
  shuttle: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2.5" />
      <path d="M3 11h18M8 5v6M13 5v6" />
      <circle cx="7.5" cy="19" r="1.5" />
      <circle cx="16.5" cy="19" r="1.5" />
    </>
  ),
  restaurant: (
    <>
      <path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10" />
      <path d="M17 21V3c-2.5 1.5-3.5 4.5-3.5 8H17" />
    </>
  ),
  spa: (
    <>
      <path d="M12 20c-4.5 0-8-3-8-7 3.5 0 6.5 1.5 8 4 1.5-2.5 4.5-4 8-4 0 4-3.5 7-8 7Z" />
      <path d="M12 17c-2.5-1.2-3.5-4.5-3.5-8 0-2 1.2-4 3.5-5.5 2.3 1.5 3.5 3.5 3.5 5.5 0 3.5-1 6.8-3.5 8Z" />
    </>
  ),
  bed: (
    <>
      <path d="M3 18V6M3 14h18v4M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5" />
      <circle cx="7" cy="11" r="1.8" />
    </>
  ),
  bath: (
    <>
      <path d="M4 12h16v2.5a4.5 4.5 0 0 1-4.5 4.5h-7A4.5 4.5 0 0 1 4 14.5V12ZM6 19l-1 2M18 19l1 2" />
      <path d="M6 12V6.5A2.5 2.5 0 0 1 8.5 4c1.2 0 2 .6 2.4 1.5" />
    </>
  ),
  ac: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  coffee: (
    <>
      <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9ZM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3" />
    </>
  ),
  balcony: (
    <>
      <path d="M4 21V9a8 8 0 0 1 16 0v12M4 14h16M9 14v7M15 14v7" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4 5.4-2.2Z" />
    </>
  ),
  phone: (
    <path d="M6.5 3.5h3l1.5 4-2 1.3a11 11 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 8h16M4 16h16" />,
  quote: (
    <path
      fill="currentColor"
      stroke="none"
      d="M9.5 6C6 7.2 4 10 4 13.6V18h6v-6H7.2c.2-1.8 1.2-3 3.2-3.8L9.5 6Zm9 0c-3.5 1.2-5.5 4-5.5 7.6V18h6v-6h-2.8c.2-1.8 1.2-3 3.2-3.8L18.5 6Z"
    />
  ),
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M8 5.5v13l11-6.5-11-6.5Z" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19.5c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7M16 5.8a3 3 0 0 1 0 5.4M17.5 15c2 .5 3.2 2 3.7 4.5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 24, className }: IconProps) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
