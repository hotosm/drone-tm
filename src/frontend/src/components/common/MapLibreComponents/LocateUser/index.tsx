import { GeolocateControl } from 'maplibre-gl';
import { useEffect } from 'react';
import { useMap } from '../MapContext';

const LocateUser = () => {
  const { map, isMapLoaded } = useMap();
  useEffect(() => {
    if (!map || !isMapLoaded) return;
    // Add geolocate control to the map.
    map.addControl(
      new GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },
        trackUserLocation: true,
      }),
      'top-left',
    );
  }, [map, isMapLoaded]);

  return null;
};

export default LocateUser;
