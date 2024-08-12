import { authenticated, api } from '.';

export const getTaskStatistics = () =>
  authenticated(api).get('/tasks/statistics/');

export const getTaskList = () => authenticated(api).get('/tasks/');
