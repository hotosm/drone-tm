import storage from 'redux-persist/lib/storage';
import { persistReducer } from 'redux-persist';
import { AnyAction, Reducer } from '@reduxjs/toolkit';
import { RootState } from './reducers';

export default function persist(
  key: string,
  whitelist: string[],
  reducer: Reducer,
) {
  return persistReducer<RootState, AnyAction>(
    {
      key,
      storage,
      whitelist,
    },
    reducer,
  ) as Reducer;
}
