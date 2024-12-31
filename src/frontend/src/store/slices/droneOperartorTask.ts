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
  clickedImage: string;
  checkedImages: Record<number, boolean>;
  popOver: boolean;
  files: any[];
  selectedTakeOffPointOption: string;
  selectedTakeOffPoint: any[] | string | null;
  uploadedImagesType: 'add' | 'replace';
  selectedTaskDetailToViewOrthophoto: any;
  filesExifData: IFilesExifData[];
  waypointMode: 'waypoints' | 'waylines';
  taskAssetsInformation: Record<string, any>;
}

const initialState: IDroneOperatorTaskState = {
  secondPage: false,
  secondPageState: 'description',
  clickedImage: '',
  checkedImages: {},
  popOver: false,
  files: [],
  selectedTakeOffPointOption: 'current_location',
  selectedTakeOffPoint: null,
  uploadedImagesType: 'add',
  selectedTaskDetailToViewOrthophoto: null,
  filesExifData: [],
  waypointMode: 'waypoints',
  taskAssetsInformation: {
    total_image_uploaded: 0,
    assets_url: '',
    state: '',
  },
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
    setSelectedImage: (state, action) => {
      state.clickedImage = action.payload;
    },
    setCheckedImages: (state, action) => {
      state.checkedImages = action.payload;
    },
    unCheckImages: (state, action) => {
      state.checkedImages[action.payload] =
        !state.checkedImages[action.payload];
    },
    showPopover: state => {
      state.popOver = !state.popOver;
    },
    unCheckAllImages: state => {
      Object.keys(state.checkedImages).forEach((key: any) => {
        state.checkedImages[key] = false;
      });
    },
    checkAllImages: state => {
      Object.keys(state.checkedImages).forEach((key: any) => {
        state.checkedImages[key] = true;
      });
    },
    setFiles: (state, action) => {
      state.files = action.payload;
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
    resetFilesExifData: state => {
      state.filesExifData = [];
    },
    setWaypointMode: (state, action) => {
      state.waypointMode = action.payload;
    },
    setTaskAssetsInformation: (state, action) => {
      state.taskAssetsInformation = action.payload;
    },
  },
});

export default droneOperatorTaskSlice.reducer;
