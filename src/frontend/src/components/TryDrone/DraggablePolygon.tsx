import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Map } from "maplibre-gl";
import { Polygon } from "geojson";
import { brandRed } from "@Constants/map";

type Props = {
  map: Map | null;
  mapContainerRef: RefObject<HTMLDivElement | null>;
  polygon: Polygon;
  onCenterChange: (center: [number, number]) => void;
};

export const DraggablePolygon = ({
  map,
  mapContainerRef,
  polygon,
  onCenterChange,
}: Props) => {
  const [screenPoints, setScreenPoints] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Fresh refs so window event handlers always see the latest values
  const mapRef = useRef(map);
  mapRef.current = map;
  const polygonRef = useRef(polygon);
  polygonRef.current = polygon;
  const containerRef = useRef(mapContainerRef);
  containerRef.current = mapContainerRef;
  const onCenterChangeRef = useRef(onCenterChange);
  onCenterChangeRef.current = onCenterChange;

  // Drag state
  const dragStartLngLatRef = useRef<{ lng: number; lat: number } | null>(null);
  const dragStartCenterRef = useRef<[number, number] | null>(null);
  const dragPanWasEnabledRef = useRef(false);
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRafRef = useRef<number | null>(null);
  const mapRafRef = useRef<number | null>(null);

  // Project polygon corners to SVG screen coordinates
  const projectToScreen = useCallback(() => {
    const m = mapRef.current;
    const poly = polygonRef.current;
    if (!m || !poly) return;
    const coords = poly.coordinates[0].slice(0, -1); // drop GeoJSON closing duplicate
    const pts = coords
      .map(([lng, lat]) => {
        // @ts-ignore — maplibre LngLatLike accepts plain {lng, lat}
        const px = m.project({ lng, lat });
        return `${px.x},${px.y}`;
      })
      .join(" ");
    setScreenPoints(pts);
  }, []);

  // Subscribe to map move/zoom/resize — re-projects on every frame
  useEffect(() => {
    if (!map) return;
    projectToScreen();

    const schedule = () => {
      if (mapRafRef.current !== null) return;
      mapRafRef.current = requestAnimationFrame(() => {
        mapRafRef.current = null;
        projectToScreen();
      });
    };

    map.on("move", schedule);
    map.on("zoom", schedule);

    const container = mapContainerRef.current;
    let ro: ResizeObserver | null = null;
    if (container) {
      ro = new ResizeObserver(schedule);
      ro.observe(container);
    }

    return () => {
      map.off("move", schedule);
      map.off("zoom", schedule);
      if (mapRafRef.current !== null) {
        cancelAnimationFrame(mapRafRef.current);
        mapRafRef.current = null;
      }
      ro?.disconnect();
    };
  }, [map, mapContainerRef, projectToScreen]);

  // Re-project whenever the polygon geometry changes (e.g. area slider)
  useEffect(() => {
    projectToScreen();
  }, [polygon, projectToScreen]);

  // ── Pointer down: start drag ────────────────────────────────────────────

  const handlePointerDown = (e: React.PointerEvent<SVGPolygonElement>) => {
    if (!map) return;
    e.preventDefault();
    e.stopPropagation();

    const container = mapContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const lngLat = map.unproject([
      e.clientX - rect.left,
      e.clientY - rect.top,
    ]);
    dragStartLngLatRef.current = { lng: lngLat.lng, lat: lngLat.lat };

    // Compute polygon centroid as drag start reference
    const coords = polygon.coordinates[0].slice(0, -1);
    const n = coords.length;
    dragStartCenterRef.current = [
      coords.reduce((s, [lng]) => s + lng, 0) / n,
      coords.reduce((s, [, lat]) => s + lat, 0) / n,
    ];

    dragPanWasEnabledRef.current = map.dragPan?.isEnabled() ?? false;
    if (dragPanWasEnabledRef.current) map.dragPan.disable();
    map.touchZoomRotate.disable();
    map.touchPitch.disable();

    setIsDragging(true);
  };

  // ── Pointer move / up: attached to window while dragging ───────────────

  useEffect(() => {
    if (!isDragging) return;

    const computeCenter = (clientX: number, clientY: number) => {
      const m = mapRef.current;
      const container = containerRef.current.current;
      const start = dragStartLngLatRef.current;
      const startCenter = dragStartCenterRef.current;
      if (!m || !container || !start || !startCenter) return;

      const rect = container.getBoundingClientRect();
      // @ts-ignore
      const cur = m.unproject([clientX - rect.left, clientY - rect.top]);
      onCenterChangeRef.current([
        startCenter[0] + (cur.lng - start.lng),
        startCenter[1] + (cur.lat - start.lat),
      ]);
    };

    const flush = () => {
      const p = pendingPointerRef.current;
      if (!p) return;
      pendingPointerRef.current = null;
      computeCenter(p.x, p.y);
    };

    const scheduleFrame = () => {
      if (pointerRafRef.current !== null) return;
      pointerRafRef.current = requestAnimationFrame(() => {
        pointerRafRef.current = null;
        flush();
        if (pendingPointerRef.current) scheduleFrame();
      });
    };

    const onPointerMove = (e: PointerEvent) => {
      pendingPointerRef.current = { x: e.clientX, y: e.clientY };
      scheduleFrame();
    };

    const endDrag = () => {
      if (pointerRafRef.current !== null) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
      flush();

      const m = mapRef.current;
      if (m) {
        if (dragPanWasEnabledRef.current) m.dragPan.enable();
        m.touchZoomRotate.enable();
        m.touchPitch.enable();
      }

      dragStartLngLatRef.current = null;
      dragStartCenterRef.current = null;
      dragPanWasEnabledRef.current = false;
      setIsDragging(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      if (pointerRafRef.current !== null) {
        cancelAnimationFrame(pointerRafRef.current);
        pointerRafRef.current = null;
      }
      pendingPointerRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [isDragging]);

  // Forward wheel events to the map so zoom works while hovering the polygon
  const handleWheel = (e: React.WheelEvent<SVGPolygonElement>) => {
    if (!map) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = map.getCanvas().getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    map.zoomTo(map.getZoom() - e.deltaY / 300, {
      // @ts-ignore
      around: map.unproject([point.x, point.y]),
      duration: 0,
    });
  };

  if (!screenPoints) return null;

  const cursorClass = isDragging
    ? "naxatw-cursor-grabbing"
    : "naxatw-cursor-grab";

  return (
    <div
      className="naxatw-absolute naxatw-inset-0 naxatw-pointer-events-none"
      style={{ zIndex: 1 }}
    >
      <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        <polygon
          points={screenPoints}
          fill={brandRed}
          fillOpacity={0.15}
          stroke={brandRed}
          strokeWidth={2}
          className={`naxatw-pointer-events-auto ${cursorClass}`}
          style={{ touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onWheel={handleWheel}
        />
      </svg>
    </div>
  );
};
