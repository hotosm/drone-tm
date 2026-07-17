import { useState } from 'react';
import { Polygon } from 'geojson';
import {
  FlightPlanData,
  FlightPreviewTask,
  postAllTaskFiles,
  postWaypointKmz,
} from '@Services/tryDrone';

// Trigger a browser download for an in-memory blob (blob → object URL →
// synthetic anchor click → revoke). Shared by all three download handlers.
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Params = {
  polygon: Polygon;
  altitude: number;
  droneModel: string;
  gridDimension: number;
  selectedTask: FlightPreviewTask | null;
  flightPlan: FlightPlanData | null;
};

/**
 * Download handlers for the try-drone flow: the full task-set bundle (step 2),
 * and the KMZ / GeoJSON exports for a single selected task (step 3).
 */
export const useTryDroneDownloads = ({
  polygon,
  altitude,
  droneModel,
  gridDimension,
  selectedTask,
  flightPlan,
}: Params) => {
  const [downloadingAll, setDownloadingAll] = useState(false);

  const handleDownloadAllTasks = () => {
    if (downloadingAll) return;
    setDownloadingAll(true);
    postAllTaskFiles(polygon, altitude, droneModel, gridDimension)
      .then(({ blob, filename }) => triggerDownload(blob, filename))
      .finally(() => setDownloadingAll(false));
  };

  const handleDownloadKmz = () => {
    if (!selectedTask) return;
    postWaypointKmz(
      selectedTask.geometry,
      altitude,
      droneModel,
      selectedTask.id,
    ).then(({ blob, filename }) => triggerDownload(blob, filename));
  };

  // GeoJSON of the flight plan — handy to preview in any map viewer
  // (geojson.io, QGIS, Google Earth) without loading it onto a drone.
  // Includes both the flight path (LineString) and the waypoints (Points).
  const handleDownloadGeojson = () => {
    if (!flightPlan || !selectedTask) return;
    const featureCollection = {
      type: 'FeatureCollection' as const,
      ...(flightPlan.droneMetadata
        ? { drone_metadata: flightPlan.droneMetadata }
        : {}),
      features: [
        ...flightPlan.geojsonAsLineString.features,
        ...flightPlan.geojsonListOfPoints.features,
      ],
    };
    const blob = new Blob([JSON.stringify(featureCollection)], {
      type: 'application/json',
    });
    triggerDownload(
      blob,
      `flightplan-${selectedTask.id}-${droneModel}.geojson`,
    );
  };

  return {
    downloadingAll,
    handleDownloadAllTasks,
    handleDownloadKmz,
    handleDownloadGeojson,
  };
};
