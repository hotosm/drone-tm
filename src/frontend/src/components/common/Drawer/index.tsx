import { ReactNode, useEffect, useCallback } from "react";

interface IDrawerProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
}

export default function Drawer({
  open,
  onClose,
  children,
  className = "",
  overlayClassName = "",
  contentClassName = "",
}: IDrawerProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEscape);
    }
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, handleEscape]);

  return (
    <div
      className={`naxatw-fixed naxatw-inset-0 naxatw-z-[999] naxatw-transition-all naxatw-duration-200 ${
        open ? "naxatw-visible naxatw-opacity-100" : "naxatw-invisible naxatw-opacity-0"
      } ${className}`.trim()}
    >
      {/* Overlay */}
      <div
        className={`naxatw-absolute naxatw-inset-0 naxatw-bg-black/40 ${overlayClassName}`.trim()}
        onClick={onClose}
        role="presentation"
      />

      {/* Drawer panel - slides from top */}
      <div
        className={`naxatw-absolute naxatw-left-0 naxatw-right-0 naxatw-top-0 naxatw-bg-white naxatw-shadow-lg naxatw-transition-transform naxatw-duration-200 naxatw-ease-out ${
          open ? "naxatw-translate-y-0" : "-naxatw-translate-y-full"
        } ${contentClassName}`.trim()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
