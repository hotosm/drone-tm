import storage from 'redux-persist/lib/storage';
import { persistReducer } from 'redux-persist';
import type { PersistConfig } from 'redux-persist';
import type { PersistPartial } from 'redux-persist/lib/persistReducer'
import type { AnyAction, Reducer } from '@reduxjs/toolkit';

export default function persist<S>(
  key: string,
  whitelist: (keyof S)[],
  reducer: Reducer<S, AnyAction>,
): Reducer<S & PersistPartial, AnyAction> {
  const persistConfig: PersistConfig<S> = {
    key,
    storage,
    whitelist: whitelist as string[],
  };

  return persistReducer(persistConfig, reducer);
}
