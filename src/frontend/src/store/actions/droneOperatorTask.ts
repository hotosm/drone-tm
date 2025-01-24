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
  setFilesExifData,
  resetFilesExifData,
  setWaypointMode,
  setTaskAssetsInformation,
  setRotatedFlightPlan,
  setRotationAngle,
} = droneOperatorTaskSlice.actions;
