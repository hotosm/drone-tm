import {
  AnyAction,
  CombinedState,
  combineReducers,
  Reducer,
} from '@reduxjs/toolkit';
import user, { UserState } from '../slices/user';

export interface IRootReducer {
  user: UserState;
}

const rootReducer: Reducer<
  CombinedState<IRootReducer>,
  AnyAction
> = combineReducers({
  user,
});

export default rootReducer;
