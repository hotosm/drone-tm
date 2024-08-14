/* eslint-disable no-unused-vars */
import type { ReactElement } from 'react';
import type { Map, MapOptions } from 'maplibre-gl';
import type { Feature, FeatureCollection, GeoJsonTypes } from 'geojson';
import type { DrawMode } from '@mapbox/mapbox-gl-draw';

export type MapInstanceType = Map;

export type MapOptionsType = {
  containerId?: string;
  mapOptions?: Partial<MapOptions>;
  enable3D?: boolean;
  disableRotation?: boolean;
};

export interface IMapOptionsProps extends Partial<MapOptionsType> {}

export interface IMapContainer {
  // children?: ReactNode;
  children?: ReactElement<any> | ReactElement<any>[] | any;
  containerId?: string;
  map: MapInstanceType | null;
  isMapLoaded: Boolean;
  style?: Object;
}

export interface IBaseLayerSwitcher {
  map?: MapInstanceType;
  baseLayers?: object;
  activeLayer?: string;
}

export interface ILayer {
  map?: MapInstanceType;
  isMapLoaded?: Boolean;
  id: Number | String;
  style?: Object;
  layerOptions?: Object;
  visibleOnMap?: Boolean;
}

export type GeojsonType = GeoJsonTypes | FeatureCollection | Feature;

export interface IVectorLayer extends ILayer {
  geojson: GeojsonType | null;
  interactions?: string[];
  onFeatureSelect?: (properties: Record<string, any>) => void;
  hasImage?: boolean;
  image?: any;
  symbolPlacement?: 'point' | 'line' | 'line-center';
  iconAnchor?:
    | 'center'
    | 'left'
    | 'right'
    | 'top'
    | 'bottom'
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right';
}

type InteractionsType = 'hover' | 'select';

export interface IVectorTileLayer extends ILayer {
  url: string;
  interactions?: InteractionsType[];
  onFeatureSelect?: (properties: Record<string, any>) => void;
}

export interface IAsyncPopup {
  map?: MapInstanceType;
  isMapLoaded?: Boolean;
  fetchPopupData?: (properties: Record<string, any>) => void;
  popupUI?: (properties: Record<string, any>) => ReactElement;
  title?: string;
  handleBtnClick?: (properties: Record<string, any>) => void;
  isLoading?: boolean;
  onClose?: () => void;
  buttonText?: string;
  hideButton?: boolean;
}

export type DrawModeTypes = DrawMode | null | undefined;

export interface IUseDrawToolProps {
  map?: MapInstanceType | null;
  enable: boolean;
  drawMode: DrawModeTypes;
  geojson?: GeojsonType | null;
  styles: Record<string, any>[];
  onDrawEnd: (geojson: GeojsonType | null) => void;
}
