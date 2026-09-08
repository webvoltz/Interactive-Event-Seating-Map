import Icon, { type IconName } from './Icon';

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick: () => void;
  className?: string;
  /** Extra classes applied to the icon itself (e.g. a rotation transition),
   * on top of its default size - for buttons whose glyph animates
   * independently of the button's own position/visibility. */
  iconClassName?: string;
}

export default function IconButton({
  icon,
  label,
  onClick,
  className = '',
  iconClassName = '',
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`cursor-pointer bg-white hover:bg-gray-50 text-gray-700 p-3 rounded-full shadow-lg border border-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${className}`}
    >
      <Icon name={icon} className={`w-5 h-5 ${iconClassName}`} />
    </button>
  );
}
