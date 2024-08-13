/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

export interface IDroneOperatorTaskState {
  secondPage: boolean;
  secondPageState: string;
}

const initialState: IDroneOperatorTaskState = {
  secondPage: false,
  secondPageState: 'description',
};

export const droneOperatorTaskSlice = createSlice({
  name: 'droneOperatorTask',
  initialState,
  reducers: {
    setSecondPage: (state, action) => {
      state.secondPage = action.payload;
    },
    setSecondPageState: (state, action) => {
      state.secondPageState = action.payload;
    },
  },
});

export default droneOperatorTaskSlice.reducer;
