import { useEffect } from 'react';
import mapLibre, { RasterSourceSpecification } from 'maplibre-gl';
import { cogProtocol } from '@geomatico/maplibre-cog-protocol';
import { useMap } from '../MapContext';

interface IViewOrthophotoProps {
  id: string;
  source: RasterSourceSpecification;
  visibleOnMap?: Boolean;
  zoomToLayer?: Boolean;
}

const COGOrthophotoViewer = ({
  id,
  source,
  visibleOnMap,
  zoomToLayer = false,
}: IViewOrthophotoProps) => {
  const { map, isMapLoaded } = useMap();
  useEffect(() => {
    if (!map || !isMapLoaded || !source || !visibleOnMap) return;

    const handleZoomToGeoTiff = () => {
      if (map?.getSource(id))
        // @ts-ignore
        map?.fitBounds(map?.getSource(id)?.bounds, {
          padding: 50,
          duration: 1000,
          zoom: 18,
        });
      map.off('idle', handleZoomToGeoTiff);
    };

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

    if (zoomToLayer && map?.getLayer(id)) map.on('idle', handleZoomToGeoTiff);

    // eslint-disable-next-line consistent-return
    return () => {
      if (map?.getSource(id)) {
        if (map?.getLayer(id)) map?.removeLayer(id);
        map?.removeSource(id);
        map.off('idle', handleZoomToGeoTiff);
      }
    };
  }, [map, isMapLoaded, id, source, visibleOnMap, zoomToLayer]);

  return null;
};

export default COGOrthophotoViewer;
