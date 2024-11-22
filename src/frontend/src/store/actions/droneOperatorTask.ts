import { droneOperatorTaskSlice } from '@Store/slices/droneOperartorTask';

export const {
  setSecondPage,
  setSecondPageState,
  setSelectedImage,
  setCheckedImages,
  unCheckImages,
  showPopover,
  unCheckAllImages,
  checkAllImages,
  setFiles,
  setSelectedTakeOffPointOption,
  setSelectedTakeOffPoint,
  setUploadedImagesType,
  setSelectedTaskDetailToViewOrthophoto,
} = droneOperatorTaskSlice.actions;
