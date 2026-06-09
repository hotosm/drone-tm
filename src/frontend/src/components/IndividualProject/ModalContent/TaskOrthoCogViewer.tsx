import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/WebGLTile";
import GeoTIFF from "ol/source/GeoTIFF";
import Zoom from "ol/control/Zoom";
import "ol/ol.css";

interface TaskOrthoCogViewerProps {
  signedUrl: string;
  title?: string;
  onClose: () => void;
}

const TaskOrthoCogViewer = ({ signedUrl, title, onClose }: TaskOrthoCogViewerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    setLoadError(null);

    const container = containerRef.current;
    let cancelled = false;
    let map: Map | null = null;
    let raf = 0;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);

    (async () => {
      // ODM fast-ortho COGs are RGBA (3 colour bands + alpha). Letting OL
      // auto-detect band layout works for these; setting convertToRGB:true
      // breaks composeTile_ because OL then expects a different band count
      // than the source actually returns.
      const source = new GeoTIFF({
        sources: [{ url: signedUrl, nodata: 0 }],
      });

      source.on("error", (event: any) => {
        const detail = event?.error?.message || "Failed to load orthophoto.";
        if (!cancelled) setLoadError(detail);
      });

      // Await the view config so we can construct a real View synchronously
      // before the map renders. The async `view: promise` pattern races
      // with our initial fit() call and leaves the user staring at the
      // GeoTIFF's default (zoomed-in) resolution.
      let viewConfig: any;
      try {
        viewConfig = await source.getView();
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
        return;
      }
      if (cancelled) return;

      // OL's GeoTIFF view config includes a `resolutions` array (one entry
      // per COG overview level). When `resolutions` is passed to a View,
      // OL installs createSnapToResolutions as the constraint function, and
      // that hard-clamps zoom-out at resolutions[0] regardless of what we
      // set for maxResolution or showFullExtent. The only way to lift the
      // cap is to construct the View *without* the resolutions array, using
      // explicit min/maxResolution bounds instead. The GeoTIFF source still
      // picks the right overview to fetch based on the view's resolution.
      const sourceResolutions: number[] | undefined = viewConfig.resolutions;
      const smallestRes = sourceResolutions?.[sourceResolutions.length - 1] ?? 0.01;
      const largestRes = sourceResolutions?.[0] ?? 100;

      // Pick an initial resolution that fits the full extent into the
      // current modal viewport, with a bit of padding. Use window dims as
      // a stand-in for the not-yet-laid-out container - the post-mount
      // view.fit() call below refines this once map.getSize() is known.
      const extent: [number, number, number, number] | undefined = viewConfig.extent;
      const approxW = window.innerWidth * 0.8;
      const approxH = window.innerHeight * 0.85;
      const fitRes = extent
        ? Math.max((extent[2] - extent[0]) / approxW, (extent[3] - extent[1]) / approxH) * 1.1
        : largestRes;

      const cfg: any = {
        projection: viewConfig.projection,
        center: viewConfig.center,
        extent,
        showFullExtent: true,
        smoothExtentConstraint: true,
        constrainOnlyCenter: true,
        // Allow 16x further zoom-out than the lowest overview, and 4x
        // further zoom-in than native (useful for pixel-peeping).
        minResolution: smallestRes / 4,
        maxResolution: largestRes * 16,
        resolution: fitRes,
      };

      const view = new View(cfg);

      map = new Map({
        target: container,
        layers: [new TileLayer({ source })],
        view,
        controls: [new Zoom()],
      });
      mapRef.current = map;

      // The portal-rendered container measures 0x0 on the first paint while
      // the modal is animating in. Re-measure on the next frame so OL picks
      // up the real size, then fit the full extent into the viewport.
      raf = requestAnimationFrame(() => {
        if (cancelled || !map) return;
        map.updateSize();
        const size = map.getSize();
        if (viewConfig.extent && size && size[0] > 0 && size[1] > 0) {
          view.fit(viewConfig.extent, {
            size,
            padding: [16, 16, 16, 16],
          });
        }
      });
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", handleKey);
      if (map) {
        map.setTarget(undefined);
      }
      mapRef.current = null;
    };
  }, [signedUrl, onClose]);

  return createPortal(
    <div
      className="naxatw-fixed naxatw-inset-0 naxatw-z-[11113] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black/60"
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
        {loadError && (
          <div className="naxatw-border-t naxatw-border-red-200 naxatw-bg-red-50 naxatw-px-4 naxatw-py-2 naxatw-text-xs naxatw-text-red-800">
            {loadError}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default TaskOrthoCogViewer;
