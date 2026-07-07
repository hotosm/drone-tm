import { m } from '@/paraglide/messages';
import { GeometryVisibility } from './useGeometryVisibility';

type Props = {
  visibility: GeometryVisibility;
  /** Bring the AOI box onto the current view. */
  onBringToView: () => void;
};

/**
 * Floating affordance shown when the draggable AOI box has been panned
 * off-screen.
 *
 * Because the box is the mapping AOI, it deliberately doesn't follow the
 * camera — instead we surface a pill (pinned to the top, with an arrow pointing
 * toward it) that lets the user bring the box to the current view with one tap.
 */
export const GridOffScreenNudge = ({ visibility, onBringToView }: Props) => {
  if (!visibility.isOffScreen) return null;

  const angleDeg = (visibility.angleRad * 180) / Math.PI;

  return (
    <button
      type="button"
      onClick={onBringToView}
      className="naxatw-pointer-events-auto naxatw-absolute naxatw-left-1/2 naxatw-top-4 naxatw-z-30 naxatw-flex -naxatw-translate-x-1/2 naxatw-items-center naxatw-gap-1.5 naxatw-rounded-full naxatw-border naxatw-border-grey-400 naxatw-bg-white naxatw-px-3 naxatw-py-1.5 naxatw-text-xs naxatw-text-grey-800 naxatw-shadow-md naxatw-transition-colors hover:naxatw-bg-grey-100"
      aria-label={m.trydrone_bring_box_aria()}
    >
      {/* Arrow points toward the box's current location. */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: `rotate(${angleDeg}deg)` }}
        aria-hidden="true"
      >
        <line x1="4" y1="12" x2="20" y2="12" />
        <polyline points="14 6 20 12 14 18" />
      </svg>
      <span className="naxatw-whitespace-nowrap naxatw-font-medium">
        {m.trydrone_bring_box_here()}
      </span>
    </button>
  );
};
