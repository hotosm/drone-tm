import { combineReducers } from '@reduxjs/toolkit';
import createproject from '@Store/slices/createproject';
import droneOperatorTask from '@Store/slices/droneOperartorTask';
import imageProcessingWorkflow from '@Store/slices/imageProcessingWorkflow';
import common from '../slices/common';
import loader from '../slices/loader';
import project from '../slices/project';

const rootReducer = combineReducers({
  common,
  loader,
  createproject,
  project,
  droneOperatorTask,
  imageProcessingWorkflow,
});

export default rootReducer;
