import { createSlice } from '@reduxjs/toolkit';
import type { CaseReducer, PayloadAction } from '@reduxjs/toolkit';
import persist from '@Store/persist';

export interface ProjectState {
  individualProjectActiveTab: string;
  tasksData: Record<string, any>[] | null;
  projectArea: Record<string, any> | null;
  selectedTaskId: string;
  taskClickedOnTable: Record<string, any> | null;
  showGcpEditor: boolean;
  gcpData: any;
  visibleOrthophotoList: Record<string, any>[];
}

const initialState: ProjectState = {
  individualProjectActiveTab: 'about',
  tasksData: null,
  projectArea: null,
  selectedTaskId: '',
  taskClickedOnTable: null,
  showGcpEditor: false,
  gcpData: null,
  visibleOrthophotoList: [],
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
