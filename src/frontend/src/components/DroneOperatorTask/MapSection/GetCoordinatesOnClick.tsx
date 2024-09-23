/* eslint-disable no-param-reassign */
import { MapInstanceType } from '@Components/common/MapLibreComponents/types';
import { useEffect } from 'react';

interface IGetCoordinatesOnClick {
  map?: MapInstanceType;
  isMapLoaded?: Boolean;
  getCoordinates: any;
}

const GetCoordinatesOnClick = ({
  map,
  isMapLoaded,
  getCoordinates,
}: IGetCoordinatesOnClick) => {
  useEffect(() => {
    if (!map || !isMapLoaded) return () => {};
    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', e => {
      const latLng = e.lngLat;
      getCoordinates(latLng);
    });

    return () => {
      map.getCanvas().style.cursor = '';
    };
  }, [map, isMapLoaded, getCoordinates]);
  return null;
};

export default GetCoordinatesOnClick;
