/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

export interface LoaderState {
  actions: string[];
}

const initialState: LoaderState = {
  actions: [],
};

const loaderSlice = createSlice({
  name: 'loader',
  initialState,
  reducers: {
    startAction(state, action) {
      state.actions.push(action.payload);
    },
    stopAction(state, action) {
      state.actions = state.actions.filter(item => item !== action.payload);
    },
  },
});

export { loaderSlice };

export default loaderSlice.reducer;
