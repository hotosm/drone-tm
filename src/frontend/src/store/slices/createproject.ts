import { createSlice } from '@reduxjs/toolkit';
import type { CaseReducer, PayloadAction } from '@reduxjs/toolkit';
import persist from '@Store/persist';

export interface CreateProjectState {
  projectId: number | null;
  activeStep: number;
  uploadNoFlyZone: 'yes' | 'no';
  keyParamOption: 'basic' | 'advanced';
  contributionsOption: 'public' | 'invite_with_email';
  generateTaskOption: 'divide_hexagon' | 'divide_rectangle';
  measureType: 'length' | 'area' | null;
  uploadedGeojson: Record<string, any> | null;
  splitGeojson: Record<string, any> | null;
}

const initialState: CreateProjectState = {
  projectId: null,
  activeStep: 1,
  uploadNoFlyZone: 'no',
  keyParamOption: 'basic',
  contributionsOption: 'public',
  generateTaskOption: 'divide_rectangle',
  measureType: null,
  uploadedGeojson: null,
  splitGeojson: null,
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
