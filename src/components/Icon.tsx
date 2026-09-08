const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 18L18 6M6 6l12 12',
  'zoom-in': 'M12 5v14M5 12h14',
  'zoom-out': 'M5 12h14',
  // Traced from a reference "zoom reset" icon (magnifying glass whose lens
  // is a circular arrow), whose original viewBox was 21x21 - coordinates
  // below are that path scaled by 24/21 to fit our shared 24x24 viewBox.
  'reset-view':
    'M4 9.71C4 12.87 6.56 15.43 9.71 15.43C12.87 15.43 15.43 12.87 15.43 9.71C15.43 6.56 12.87 4 9.71 4C7.88 4 6.25 4.86 5.21 6.2M5.14 1.71L5.14 6.29L9.71 6.29M20 20L13.85 13.85',
  'chevron-left': 'M15 6l-6 6 6 6',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  className?: string;
}

export default function Icon({ name, className = 'w-5 h-5' }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
