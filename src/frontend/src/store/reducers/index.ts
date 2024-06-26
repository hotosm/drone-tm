import {
  AnyAction,
  CombinedState,
  combineReducers,
  Reducer,
} from '@reduxjs/toolkit';
import createproject, { CreateProjectState } from '@Store/slices/createproject';
import common, { CommonState } from '../slices/common';
import loader, { LoaderState } from '../slices/loader';

export interface IRootReducer {
  common: CommonState;
  loader: LoaderState;
  createproject: CreateProjectState;
}

const rootReducer: Reducer<
  CombinedState<IRootReducer>,
  AnyAction
> = combineReducers({
  common,
  loader,
  createproject,
});

export default rootReducer;
