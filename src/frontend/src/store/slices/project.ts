import { createSlice } from '@reduxjs/toolkit';
import type { CaseReducer, PayloadAction } from '@reduxjs/toolkit';
import persist from '@Store/persist';

export interface ProjectState {
  individualProjectActiveTab: string;
  tasksGeojson: Record<string, any>[] | null;
  projectArea: Record<string, any> | null;
}

const initialState: ProjectState = {
  individualProjectActiveTab: 'tasks',
  tasksGeojson: null,
  projectArea: null,
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
