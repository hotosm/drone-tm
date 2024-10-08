import {
  AnyAction,
  CombinedState,
  combineReducers,
  Reducer,
} from '@reduxjs/toolkit';
import createproject, { CreateProjectState } from '@Store/slices/createproject';
import droneOperatorTask, {
  IDroneOperatorTaskState,
} from '@Store/slices/droneOperartorTask';
import common, { CommonState } from '../slices/common';
import loader, { LoaderState } from '../slices/loader';
import project, { ProjectState } from '../slices/project';

export interface IRootReducer {
  common: CommonState;
  loader: LoaderState;
  createproject: CreateProjectState;
  project: ProjectState;
  droneOperatorTask: IDroneOperatorTaskState;
}

const rootReducer: Reducer<
  CombinedState<IRootReducer>,
  AnyAction
> = combineReducers({
  common,
  loader,
  createproject,
  project,
  droneOperatorTask,
});

export default rootReducer;
