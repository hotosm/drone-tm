import { createSlice } from '@reduxjs/toolkit';
import type { CaseReducer, PayloadAction } from '@reduxjs/toolkit';
import persist from '@Store/persist';

export interface ProjectState {
  individualProjectActiveTab: string;
}

const initialState: ProjectState = {
  individualProjectActiveTab: 'tasks',
};

const setProjectState: CaseReducer<
  ProjectState,
  PayloadAction<Partial<Partial<ProjectState>>>
> = (state, action) => ({
  ...state,
  ...action.payload,
});

const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    setProjectState,
  },
});

export { projectSlice };

export default persist('common', [], projectSlice.reducer);
