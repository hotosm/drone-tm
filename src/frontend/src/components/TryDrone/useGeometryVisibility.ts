import { RefObject, useCallback, useEffect, useState } from 'react';
import { Map } from 'maplibre-gl';

export type GeometryVisibility = {
  /** True when the geometry's bbox no longer intersects the current viewport. */
  isOffScreen: boolean;
  /** Angle (radians, screen space) from the viewport centre to the geometry centre. */
  angleRad: number;
};

type Options = {
  map: Map | null;
  mapContainerRef: RefObject<HTMLDivElement | null>;
  /** Geometry bounds as [west, south, east, north] (matches @turf/bbox output). */
  bbox: [number, number, number, number] | null;
  /** When true, visibility is never reported as off-screen. */
  disabled?: boolean;
};

const HIDDEN: GeometryVisibility = {
  isOffScreen: false,
  angleRad: 0,
};

/**
 * Tracks whether a geometry (e.g. the draggable AOI box) has been left outside
 * the current viewport.
 *
 * The box doubles as the mapping AOI, so it deliberately does *not* follow the
 * camera — instead this hook detects when it is fully off-screen so the UI can
 * offer a one-tap "bring it here" affordance. When off-screen it also computes
 * the on-screen direction toward the geometry so an arrow can point back to it.
 */
export const useGeometryVisibility = ({
  map,
  mapContainerRef,
  bbox,
  disabled = false,
}: Options): GeometryVisibility => {
  const [visibility, setVisibility] = useState<GeometryVisibility>(HIDDEN);

  // Depend on the bbox *values*, not the array reference: callers typically
  // build the bbox inline (e.g. `@turf/bbox(...)`), producing a fresh array
  // every render. Keying `recompute` on the numbers keeps it stable so the
  // effect doesn't re-subscribe (and re-set state) on every render.
  const west = bbox?.[0] ?? null;
  const south = bbox?.[1] ?? null;
  const east = bbox?.[2] ?? null;
  const north = bbox?.[3] ?? null;

  const recompute = useCallback(() => {
    if (
      !map ||
      disabled ||
      west === null ||
      south === null ||
      east === null ||
      north === null
    ) {
      setVisibility(prev => (prev.isOffScreen ? HIDDEN : prev));
      return;
    }

    const bounds = map.getBounds();
    const mapWest = bounds.getWest();
    const mapEast = bounds.getEast();
    const mapSouth = bounds.getSouth();
    const mapNorth = bounds.getNorth();

    // The geometry is visible if its bbox overlaps the viewport bbox at all.
    const intersects = !(
      east < mapWest ||
      west > mapEast ||
      north < mapSouth ||
      south > mapNorth
    );

    if (intersects) {
      setVisibility(prev => (prev.isOffScreen ? HIDDEN : prev));
      return;
    }

    // Off-screen: the nudge lives in a fixed spot, but its arrow points from
    // the viewport centre toward the geometry so the user knows which way it went.
    const centerPixel = map.project({
      lng: (west + east) / 2,
      lat: (south + north) / 2,
    });

    const container = mapContainerRef.current;
    const centerX = (container?.clientWidth ?? 0) / 2;
    const centerY = (container?.clientHeight ?? 0) / 2;

    const angleRad = Math.atan2(
      centerPixel.y - centerY,
      centerPixel.x - centerX,
    );

    setVisibility(prev =>
      prev.isOffScreen && prev.angleRad === angleRad
        ? prev
        : { isOffScreen: true, angleRad },
    );
  }, [map, west, south, east, north, mapContainerRef, disabled]);

  useEffect(() => {
    if (!map) return undefined;

    recompute();
    map.on('move', recompute);
    map.on('moveend', recompute);

    return () => {
      map.off('move', recompute);
      map.off('moveend', recompute);
    };
  }, [map, recompute]);

  return visibility;
};
