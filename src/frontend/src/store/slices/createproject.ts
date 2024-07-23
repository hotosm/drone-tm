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
  uploadedProjectArea: Record<string, any> | null;
  uploadedNoFlyZone: Record<string, any> | null;
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
  uploadedProjectArea: null,
  uploadedNoFlyZone: null,
  splitGeojson: null,
  isTerrainFollow: 'flat',
};

const setCreateProjectState: CaseReducer<
  CreateProjectState,
  PayloadAction<Partial<Partial<CreateProjectState>>>
> = (state, action) => ({
  ...state,
  ...action.payload,
});

const createProjectSlice = createSlice({
  name: 'create project',
  initialState,
  reducers: {
    setCreateProjectState,
  },
});

export { createProjectSlice };

export default persist('common', [], createProjectSlice.reducer);
