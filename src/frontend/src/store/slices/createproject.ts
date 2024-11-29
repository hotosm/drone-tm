import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import { createSlice } from '@reduxjs/toolkit';
import type { CaseReducer, PayloadAction } from '@reduxjs/toolkit';
import persist from '@Store/persist';

export interface CreateProjectState {
  projectId: number | null;
  activeStep: number;
  keyParamOption: 'basic' | 'advanced';
  measurementType: 'gsd' | 'altitude';
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
  isTerrainFollow: boolean;
  requireApprovalFromManagerForLocking: string;
  capturedProjectMap: boolean;
  projectMapImage: any;
  imageMergeType: string;
  ProjectsFilterByOwner: 'yes' | 'no';
  requiresApprovalFromRegulator: 'required' | 'not_required';
  regulatorEmails: string[] | [];
}

const initialState: CreateProjectState = {
  projectId: null,
  activeStep: 1,
  keyParamOption: 'basic',
  measurementType: 'gsd',
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
  isTerrainFollow: false,
  requireApprovalFromManagerForLocking: 'not_required',
  capturedProjectMap: true,
  projectMapImage: null,
  imageMergeType: 'overlap',
  ProjectsFilterByOwner: 'no',
  requiresApprovalFromRegulator: 'not_required',
  regulatorEmails: [],
};

const setCreateProjectState: CaseReducer<
  CreateProjectState,
  PayloadAction<Record<string, any>>
> = (state, action) => ({
  ...state,
  ...action.payload,
});

const saveProjectImageFile: CaseReducer<
  CreateProjectState,
  PayloadAction<Record<string, any>>
> = (state, action) => ({
  ...state,
  projectMapImage: action.payload,
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
  splitGeojson: initialState.splitGeojson,
});

const createProjectSlice = createSlice({
  name: 'create project',
  initialState,
  reducers: {
    setCreateProjectState,
    saveProjectImageFile,
    resetUploadedAndDrawnAreas,
  },
});

export { createProjectSlice };

export default persist('common', [], createProjectSlice.reducer);
