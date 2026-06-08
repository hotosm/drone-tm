import { droneOperatorTaskSlice } from "@Store/slices/droneOperartorTask";

export const {
  setSecondPage,
  setSecondPageState,
  showPopover,
  setSelectedTakeOffPointOption,
  setSelectedTakeOffPoint,
  setUploadedImagesType,
  setFilesExifData,
  setUploadProgress,
  resetFilesExifData,
  setWaypointMode,
  setDroneModel,
  setGimbalAngle,
  setTaskAssetsInformation,
  setRotatedFlightPlan,
  setRotationAngle,
  setTaskAreaPolygon,
} = droneOperatorTaskSlice.actions;
