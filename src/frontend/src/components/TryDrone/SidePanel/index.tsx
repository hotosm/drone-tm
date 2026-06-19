import { useEffect, useState } from 'react';
import useWindowDimensions from '@Hooks/useWindowDimensions';

const MOBILE_BREAKPOINT = 768;
const PEEK_HEIGHT = 56;

interface Props {
  children: React.ReactNode;
  collapseSignal?: unknown; // changes to this re-collapse the mobile sheet
}

export default function TryDroneSidePanel({ children, collapseSignal }: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const [expanded, setExpanded] = useState(false);

  // collapse the bottom sheet whenever the flow step changes
  useEffect(() => {
    setExpanded(false);
  }, [collapseSignal]);

  if (!isMobile) {
    return (
      <div
        data-tour="panel"
        className="naxatw-absolute naxatw-right-4 naxatw-top-4 naxatw-z-10 naxatw-w-72 naxatw-overflow-y-auto naxatw-rounded-lg naxatw-bg-white naxatw-shadow-lg"
        style={{ maxHeight: 'calc(100% - 2rem)' }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      data-tour="panel"
      className="naxatw-fixed naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-z-10 naxatw-rounded-t-xl naxatw-bg-white naxatw-shadow-top"
      style={{
        maxHeight: '80vh',
        transform: expanded
          ? 'translateY(0)'
          : `translateY(calc(100% - ${PEEK_HEIGHT}px))`,
        transition: 'transform 0.3s ease',
      }}
    >
      <button
        type="button"
        aria-label="Expand or collapse panel"
        className="naxatw-flex naxatw-w-full naxatw-cursor-pointer naxatw-justify-center naxatw-py-3"
        onClick={() => setExpanded(v => !v)}
      >
        <span className="naxatw-h-1.5 naxatw-w-12 naxatw-rounded-full naxatw-bg-grey-400" />
      </button>
      <div
        className="naxatw-overflow-y-auto"
        style={{ maxHeight: `calc(80vh - ${PEEK_HEIGHT}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
