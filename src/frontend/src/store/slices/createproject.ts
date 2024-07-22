import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { createSlice } from '@reduxjs/toolkit';
import type { CaseReducer, PayloadAction } from '@reduxjs/toolkit';
import persist from '@Store/persist';

export interface CreateProjectState {
  projectId: number | null;
  activeStep: number;
  keyParamOption: 'basic' | 'advanced';
  contributionsOption: 'public' | 'invite_with_email';
  generateTaskOption: 'divide_hexagon' | 'divide_rectangle';
  isNoflyzonePresent: 'yes' | 'no';
  projectArea: GeojsonType | null;
  noFlyZone: GeojsonType | null;
  drawProjectAreaEnable: boolean;
  drawNoFlyZoneEnable: boolean;
  drawnProjectArea: GeojsonType | null;
  drawnNoFlyZone: GeojsonType | null;
  splitGeojson: Record<string, any> | null;
  isTerrainFollow: string;
}

const initialState: CreateProjectState = {
  projectId: null,
  activeStep: 1,
  keyParamOption: 'basic',
  contributionsOption: 'public',
  generateTaskOption: 'divide_rectangle',
  isNoflyzonePresent: 'no',
  projectArea: null,
  noFlyZone: null,
  drawProjectAreaEnable: false,
  drawNoFlyZoneEnable: false,
  drawnProjectArea: null,
  drawnNoFlyZone: null,
  splitGeojson: null,
  isTerrainFollow: 'flat',
};

const setCreateProjectState: CaseReducer<
  CreateProjectState,
  PayloadAction<Record<string, any>>
> = (state, action) => ({
  ...state,
  ...action.payload,
});

const resetUploadedAndDrawnAreas: CaseReducer<CreateProjectState> = state => ({
  ...state,
  isNoflyzonePresent: initialState.isNoflyzonePresent,
  projectArea: initialState.projectArea,
  noFlyZone: initialState.noFlyZone,
  drawProjectAreaEnable: initialState.drawProjectAreaEnable,
  drawNoFlyZoneEnable: initialState.drawNoFlyZoneEnable,
  drawnProjectArea: initialState.drawnProjectArea,
  drawnNoFlyZone: initialState.drawnNoFlyZone,
});

const createProjectSlice = createSlice({
  name: 'create project',
  initialState,
  reducers: {
    setCreateProjectState,
    resetUploadedAndDrawnAreas,
  },
});

export { createProjectSlice };

export default persist('common', [], createProjectSlice.reducer);
