/* eslint-disable import/prefer-default-export */
import { authenticated, api } from '.';

export const getTaskStatistics = () =>
  authenticated(api).get('/tasks/statistics/');
