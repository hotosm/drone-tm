import type { Reducer } from '@reduxjs/toolkit';
import { combineReducers } from '@reduxjs/toolkit';
import user, { UserState } from '../slices/user';

export interface RootState {
  user: UserState;
}

const rootReducer: Reducer<RootState> = combineReducers<RootState>({
  user,
});

export default rootReducer;
