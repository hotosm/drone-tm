/* eslint-disable no-unused-vars */
import type { DrawMode } from '@mapbox/mapbox-gl-draw';
import type { Feature, FeatureCollection, GeoJsonTypes } from 'geojson';
import type { Map, MapOptions } from 'maplibre-gl';
import type { ReactElement } from 'react';

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
  map?: MapInstanceType | null;
  baseLayers?: object;
  activeLayer?: string;
  isMapLoaded?: Boolean;
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
  imageLayerOptions?: Object;
  zoomToExtent?: boolean;
  onDrag?: (e: any) => void;
  onDragEnd?: () => void;
  needDragEvent?: boolean;
  imageLayoutOptions?: Object;
}

type InteractionsType = 'hover' | 'select';

export interface IVectorTileLayer extends ILayer {
  url: string;
  interactions?: InteractionsType[];
  onFeatureSelect?: (properties: Record<string, any>) => void;
}

export interface IAsyncPopup {
  map?: MapInstanceType;
  fetchPopupData?: (properties: Record<string, any>) => void;
  popupUI?: (properties: Record<string, any>) => ReactElement;
  title?: string;
  handleBtnClick?: (properties: Record<string, any>) => void;
  isLoading?: boolean;
  onClose?: () => void;
  buttonText?: string;
  hideButton?: boolean;
  getCoordOnProperties?: boolean;
  showPopup?: (clickedFeature: Record<string, any>) => Boolean;
  hasSecondaryButton?: boolean;
  secondaryButtonText?: string;
  handleSecondaryBtnClick?: (properties: Record<string, any>) => void;
  openPopupFor?: Record<string, any> | null;
  popupCoordinate?: number[];
  closePopupOnButtonClick?: boolean;
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
