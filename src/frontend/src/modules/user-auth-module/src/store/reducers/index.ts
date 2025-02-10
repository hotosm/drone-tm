import { combineReducers } from '@reduxjs/toolkit';
import user, { UserState } from '../slices/user';

export interface IRootReducer {
  user: UserState;
}

const rootReducer = combineReducers<IRootReducer>({
  user,
});

export default rootReducer;
