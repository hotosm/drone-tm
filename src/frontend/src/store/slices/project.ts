import { createSlice } from '@reduxjs/toolkit';
import type { CaseReducer, PayloadAction } from '@reduxjs/toolkit';
import persist from '@Store/persist';

export interface ProjectState {
  individualProjectActiveTab: string;
  tasksData: Record<string, any>[] | null;
  projectArea: Record<string, any> | null;
  selectedTaskId: string;
}

const initialState: ProjectState = {
  individualProjectActiveTab: 'tasks',
  tasksData: null,
  projectArea: null,
  selectedTaskId: '',
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
