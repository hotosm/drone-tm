import { GeolocateControl } from 'maplibre-gl';
import { useEffect } from 'react';
import { MapInstanceType } from '../types';

interface ILocateTheUserProps {
  map?: MapInstanceType;
  isMapLoaded: Boolean;
}

const LocateUser = ({ map, isMapLoaded }: ILocateTheUserProps) => {
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
