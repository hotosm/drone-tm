import { combineReducers } from '@reduxjs/toolkit';
import user from '../slices/user';

const rootReducer = combineReducers({
  user,
});

export default rootReducer;
