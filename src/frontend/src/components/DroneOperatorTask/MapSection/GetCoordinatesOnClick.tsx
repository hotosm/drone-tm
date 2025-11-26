/* eslint-disable no-param-reassign */
import { useEffect } from 'react';
import { useMap } from '../../common/MapLibreComponents/MapContext';

interface IGetCoordinatesOnClick {
  getCoordinates: any;
}

const GetCoordinatesOnClick = ({
  getCoordinates,
}: IGetCoordinatesOnClick) => {
  const { map, isMapLoaded } = useMap();
  useEffect(() => {
    if (!map || !isMapLoaded) return () => {};
    map.getCanvas().style.cursor = 'crosshair';

    const handleClick = (e: any) => {
      const latLng = e.lngLat;
      getCoordinates(latLng);
    };
    map.on('click', handleClick);

    return () => {
      map.getCanvas().style.cursor = '';
      map.off('click', handleClick);
    };
  }, [map, isMapLoaded, getCoordinates]);
  return null;
};

export default GetCoordinatesOnClick;
