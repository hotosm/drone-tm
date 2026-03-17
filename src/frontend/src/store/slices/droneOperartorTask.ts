/* eslint-disable no-param-reassign */
import { createSlice } from '@reduxjs/toolkit';

export interface IFilesExifData {
  file: File;
  dateTime: string;
  coordinates: { longitude: number; latitude: number };
}
export interface IDroneOperatorTaskState {
  secondPage: boolean;
  secondPageState: string;
  popOver: boolean;
  selectedTakeOffPointOption: string;
  selectedTakeOffPoint: any[] | string | null;
  uploadedImagesType: 'add' | 'replace';
  selectedTaskDetailToViewOrthophoto: any;
  filesExifData: IFilesExifData[];
  uploadProgress: Record<string, any>;
  waypointMode: 'waylines' | 'waypoints';
  droneModel: 'DJI_MINI_4_PRO' | 'DJI_MINI_5_PRO' | 'DJI_AIR_3' | 'POTENSIC_ATOM_1' | 'POTENSIC_ATOM_2' | 'LITCHI' | 'QGROUNDCONTROL';
  gimbalAngle: '-80' | '-90' | '-45';
  taskAssetsInformation: Record<string, any>;
  rotatedFlightPlan: Record<string, any>;
  rotationAngle: number;
  taskAreaPolygon: Record<string, any>;
}

const initialState: IDroneOperatorTaskState = {
  secondPage: false,
  secondPageState: 'description',
  popOver: false,
  selectedTakeOffPointOption: 'current_location',
  selectedTakeOffPoint: null,
  uploadedImagesType: 'add',
  selectedTaskDetailToViewOrthophoto: null,
  filesExifData: [],
  uploadProgress: {},
  waypointMode: 'waylines',
  droneModel: 'DJI_MINI_4_PRO',
  gimbalAngle: '-80',
  taskAssetsInformation: {
    total_image_uploaded: 0,
    assets_url: '',
    state: '',
  },
  rotatedFlightPlan: {
    geojsonListOfPoint: {},
    geojsonAsLineString: {},
  },
  rotationAngle: 0,
  taskAreaPolygon: {},
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
    showPopover: state => {
      state.popOver = !state.popOver;
    },
    setSelectedTakeOffPointOption: (state, action) => {
      state.selectedTakeOffPointOption = action.payload;
    },
    setSelectedTakeOffPoint: (state, action) => {
      state.selectedTakeOffPoint = action.payload;
    },

    setUploadedImagesType: (state, action) => {
      state.uploadedImagesType = action.payload;
    },

    setSelectedTaskDetailToViewOrthophoto: (state, action) => {
      state.selectedTaskDetailToViewOrthophoto = action.payload;
    },
    setFilesExifData: (state, action) => {
      state.filesExifData = action.payload;
    },
    setUploadProgress: (state, action) => {
      state.uploadProgress = action.payload;
    },
    resetFilesExifData: state => {
      state.filesExifData = [];
    },
    setWaypointMode: (state, action) => {
      state.waypointMode = action.payload;
    },
    setDroneModel: (state, action) => {
      state.droneModel = action.payload;
    },
    setGimbalAngle: (state, action) => {
      state.gimbalAngle = action.payload;
    },
    setTaskAssetsInformation: (state, action) => {
      state.taskAssetsInformation = action.payload;
    },
    setRotatedFlightPlan: (state, action) => {
      state.rotatedFlightPlan = action.payload;
    },
    setRotationAngle: (state, action) => {
      state.rotationAngle = action.payload;
    },
    setTaskAreaPolygon: (state, action) => {
      state.taskAreaPolygon = action.payload;
    },
  },
});

export default droneOperatorTaskSlice.reducer;
