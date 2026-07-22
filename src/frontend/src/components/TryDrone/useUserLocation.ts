import { useEffect, useState } from 'react';

type LocationStatus = 'idle' | 'pending' | 'success' | 'error';

/**
 * Requests the browser geolocation once on mount so the try-drone flow can
 * center the initial AOI on the user's location. Pass `enabled: false` to skip
 * the request entirely (e.g. when resuming a persisted session that already has
 * a saved center — see useTryDroneWorkflow).
 *
 * `status` starts at 'pending' while the (permission-gated) lookup is in flight
 * so callers can hold the camera until the outcome is known, then resolves to
 * 'success' (with `location`) or 'error' (denied / unavailable / timed out).
 */
export function useUserLocation(enabled: boolean) {
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [status, setStatus] = useState<LocationStatus>(
    enabled ? 'pending' : 'idle',
  );

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('error');
      return undefined;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      position => {
        if (cancelled) return;
        setLocation([position.coords.longitude, position.coords.latitude]);
        setStatus('success');
      },
      () => {
        if (!cancelled) setStatus('error');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { location, status };
}
