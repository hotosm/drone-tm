/* eslint-disable react/display-name */
/* eslint-disable no-unused-vars */
/* eslint-disable no-nested-ternary */
/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable react/jsx-no-useless-fragment */
import React, { ReactElement } from 'react';
import { IMapContainer, MapInstanceType } from '../types';

const { Children, cloneElement, forwardRef } = React;

const MapContainer = forwardRef(
  (
    {
      children,
      containerId = 'maplibre-gl-map',
      map,
      isMapLoaded,
      ...rest
    }: IMapContainer,
    ref,
  ) => {
    const childrenCount = Children.count(children);
    const props = {
      map,
      isMapLoaded,
    };
    return (
      <div
        // ref={ref}
        id={containerId}
        // className="ol-map"
        {...rest}
      >
        {childrenCount < 1 ? (
          <></>
        ) : childrenCount > 1 ? (
          Children.map(children, child =>
            child ? cloneElement(child, { ...props }) : <></>,
          )
        ) : (
          cloneElement(children as ReactElement<any>, { ...props })
        )}
      </div>
    );
  },
);

export default MapContainer;
