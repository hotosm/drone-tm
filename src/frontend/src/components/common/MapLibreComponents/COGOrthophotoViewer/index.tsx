import { useEffect } from 'react';
import mapLibre, { RasterSourceSpecification } from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import { MapInstanceType } from '../types';

interface IViewOrthophotoProps {
  map?: MapInstanceType;
  isMapLoaded?: Boolean;
  id: string;
  source: RasterSourceSpecification;
  visibleOnMap?: Boolean;
}

const COGOrthophotoViewer = ({
  map,
  isMapLoaded,
  id,
  source,
  visibleOnMap,
}: IViewOrthophotoProps) => {
  useEffect(() => {
    if (!map || !isMapLoaded || !source || !visibleOnMap) return;

    // Registers the 'cog' protocol with the mapLibre instance, enabling support for Cloud Optimized GeoTIFF (COG) files
    mapLibre?.addProtocol('cog', cogProtocol);

    if (!map.getSource(id)) {
      map.addSource(id, source);
      map.addLayer({
        id,
        source: id,
        layout: {},
        ...source,
      });
    }

    // eslint-disable-next-line consistent-return
    return () => {
      if (map?.getSource(id)) {
        map?.removeSource(id);
        if (map?.getLayer(id)) map?.removeLayer(id);
      }
    };
  }, [map, isMapLoaded, id, source, visibleOnMap]);

  return null;
};

export default COGOrthophotoViewer;
