import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/WebGLTile";
import GeoTIFF from "ol/source/GeoTIFF";
import "ol/ol.css";

interface TaskOrthoCogViewerProps {
  signedUrl: string;
  title?: string;
  onClose: () => void;
}

const TaskOrthoCogViewer = ({ signedUrl, title, onClose }: TaskOrthoCogViewerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const source = new GeoTIFF({
      sources: [{ url: signedUrl }],
      // ODM fast-ortho COGs are RGB with an alpha channel; convertToRGB lets
      // OL handle the band layout uniformly without us having to inspect it.
      convertToRGB: true,
      // Don't normalise pixel values - ODM already writes 8-bit RGBA.
      normalize: false,
    });

    const map = new Map({
      target: containerRef.current,
      layers: [new TileLayer({ source })],
      view: source.getView(),
      controls: [],
    });
    mapRef.current = map;

    // The portal-rendered container measures 0x0 on the first paint while
    // the modal is animating in. Re-measure on the next frame so OL picks
    // up the real size and renders tiles at the correct resolution.
    const raf = requestAnimationFrame(() => {
      map.updateSize();
    });

    // Close on Escape - matches the rest of the app's modal conventions.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", handleKey);
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, [signedUrl, onClose]);

  return createPortal(
    <div
      className="naxatw-fixed naxatw-inset-0 naxatw-z-[100] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black/60"
      onClick={(e) => {
        // Click on the backdrop (not on the panel) dismisses.
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title || "Orthophoto preview"}
    >
      <div className="naxatw-relative naxatw-flex naxatw-h-[90vh] naxatw-w-[92vw] naxatw-flex-col naxatw-rounded-lg naxatw-bg-white naxatw-shadow-xl md:naxatw-w-[80vw]">
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-border-b naxatw-px-4 naxatw-py-2">
          <span className="naxatw-text-sm naxatw-font-semibold naxatw-text-gray-800">
            {title || "Orthophoto preview"}
          </span>
          <button
            type="button"
            aria-label="Close orthophoto preview"
            className="material-icons naxatw-cursor-pointer naxatw-text-gray-600 hover:naxatw-text-gray-900"
            onClick={onClose}
          >
            close
          </button>
        </div>
        <div ref={containerRef} className="naxatw-min-h-0 naxatw-flex-1" />
      </div>
    </div>,
    document.body,
  );
};

export default TaskOrthoCogViewer;
