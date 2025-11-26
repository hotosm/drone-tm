import React, { forwardRef, useMemo } from 'react';
import { IMapContainer } from '../types';
import { MapContext } from '../MapContext';

const MapContainer = forwardRef<HTMLDivElement, IMapContainer>(
  ({ children, containerId = 'maplibre-gl-map', map, isMapLoaded, ...rest }, ref) => {
    const contextValue = useMemo(
      () => ({
        map,
        isMapLoaded: !!isMapLoaded,
      }),
      [map, isMapLoaded],
    );

    return (
      <MapContext.Provider value={contextValue}>
        <div ref={ref} id={containerId} {...rest}>
          {children}
        </div>
      </MapContext.Provider>
    );
  },
);

export default MapContainer;
