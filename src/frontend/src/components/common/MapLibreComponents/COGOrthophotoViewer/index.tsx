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
  zoomToLayer?: Boolean;
}

const COGOrthophotoViewer = ({
  map,
  isMapLoaded,
  id,
  source,
  visibleOnMap,
  zoomToLayer = false,
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

    const zoomToSource = setTimeout(() => {
      if (map?.getSource(id) && zoomToLayer)
        // @ts-ignore
        map?.fitBounds(map?.getSource(id)?.bounds, { padding: 50 });
    }, 1000);

    // eslint-disable-next-line consistent-return
    return () => {
      if (map?.getSource(id)) {
        map?.removeSource(id);
        if (map?.getLayer(id)) map?.removeLayer(id);
      }
      clearTimeout(zoomToSource);
    };
  }, [map, isMapLoaded, id, source, visibleOnMap, zoomToLayer]);

  return null;
};

export default COGOrthophotoViewer;
