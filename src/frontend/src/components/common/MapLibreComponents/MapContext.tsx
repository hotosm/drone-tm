import { createContext, useContext } from 'react';
import { MapInstanceType } from './types';

export interface IMapContext {
  map: MapInstanceType | null;
  isMapLoaded: boolean;
}

export const MapContext = createContext<IMapContext | null>(null);

export const useMap = () => {
  const context = useContext(MapContext);
  if (context === null) {
    throw new Error('useMap must be used within a MapProvider');
  }
  return context;
};
