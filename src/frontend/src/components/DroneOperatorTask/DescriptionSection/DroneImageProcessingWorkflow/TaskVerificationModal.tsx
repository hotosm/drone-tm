import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Map as MapLibreMap, NavigationControl, AttributionControl } from 'maplibre-gl';
import { toast } from 'react-toastify';
import {
  getTaskVerificationData,
  markTaskAsVerified,
  deleteTaskImage,
  TaskVerificationData,
} from '@Services/classification';
import { FlexRow } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import AsyncPopup from '@Components/common/MapLibreComponents/NewAsyncPopup';

interface TaskVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  batchId: string;
  taskId: string;
  taskIndex: number;
  onVerified?: () => void;
}

const TaskVerificationModal = ({
  isOpen,
  onClose,
  projectId,
  batchId,
  taskId,
  taskIndex,
  onVerified,
}: TaskVerificationModalProps) => {
  const queryClient = useQueryClient();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isStyleReady, setIsStyleReady] = useState(false);
  const [popupData, setPopupData] = useState<Record<string, any>>();
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Fetch task verification data
  const { data: verificationData, isLoading, refetch } = useQuery<TaskVerificationData>({
    queryKey: ['taskVerification', projectId, batchId, taskId],
    queryFn: () => getTaskVerificationData(projectId, batchId, taskId),
    enabled: isOpen && !!projectId && !!batchId && !!taskId,
  });

  // Reset map when modal closes
  useEffect(() => {
    if (!isOpen && map) {
      map.remove();
      setMap(null);
      setIsMapLoaded(false);
      setIsStyleReady(false);
    }
  }, [isOpen]);

  // Initialize map after data is loaded and DOM is ready
  useEffect(() => {
    if (isOpen && verificationData && mapContainerRef.current && !map) {
      const mapInstance = new MapLibreMap({
        container: mapContainerRef.current,
        style: { version: 8, sources: {}, layers: [] },
        center: [0, 0],
        zoom: 2,
        maxZoom: 22,
        attributionControl: false,
        renderWorldCopies: false,
      });

      mapInstance.on('load', () => {
        setIsMapLoaded(true);
        // Additional delay to ensure style is fully ready
        setTimeout(() => {
          if (mapInstance.getStyle()) {
            setIsStyleReady(true);
          }
        }, 100);
      });

      mapInstance.dragRotate.disable();
      mapInstance.touchZoomRotate.disableRotation();

      setMap(mapInstance);

      return () => {
        if (mapInstance) {
          mapInstance.remove();
          setMap(null);
        }
      };
    }
  }, [isOpen, verificationData, map]);

  // Add map controls
  useEffect(() => {
    if (isMapLoaded && map) {
      map.addControl(new NavigationControl(), 'top-right');
      map.addControl(
        new AttributionControl({ compact: true }),
        'bottom-right',
      );
    }
  }, [isMapLoaded, map]);

  // Convert images to GeoJSON for map display
  const imageGeoJsonData = useMemo(() => {
    if (!verificationData?.images) return null;

    const features = verificationData.images
      .filter((img) => img.location?.coordinates)
      .map((img) => ({
        type: 'Feature' as const,
        properties: {
          id: img.id,
          filename: img.filename,
          status: img.status,
          rejection_reason: img.rejection_reason,
          thumbnail_url: img.thumbnail_url,
          url: img.url,
        },
        geometry: img.location,
      }));

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [verificationData]);

  const taskGeoJsonData = useMemo(() => {
    if (!verificationData?.task_geometry) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [verificationData.task_geometry],
    };
  }, [verificationData?.task_geometry]);

  // Memoize layer options to avoid unnecessary layer recreation in VectorLayer
  const taskLayerOptions = useMemo(() => ({
    type: 'fill' as const,
    paint: {
      'fill-color': '#98BBC8',
      'fill-outline-color': '#484848',
      'fill-opacity': 0.4,
    },
  }), []);

  const taskOutlineLayerOptions = useMemo(() => ({
    type: 'line' as const,
    paint: {
      'line-color': '#484848',
      'line-width': 2,
    },
  }), []);

  const imagePointLayerOptions = useMemo(() => ({
    type: 'circle' as const,
    paint: {
      'circle-color': [
        'match',
        ['get', 'status'],
        'assigned',
        '#22c55e',
        'rejected',
        '#D73F3F',
        'unmatched',
        '#eab308',
        'invalid_exif',
        '#f97316',
        'duplicate',
        '#6b7280',
        '#3b82f6',
      ],
      'circle-radius': 6,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-opacity': 0.8,
    },
  }), []);

  // Mark as verified mutation
  const verifyMutation = useMutation({
    mutationFn: () => markTaskAsVerified(projectId, taskId),
    onSuccess: () => {
      toast.success(`Task #${taskIndex} marked as fully flown`);
      queryClient.invalidateQueries({ queryKey: ['taskVerification'] });
      queryClient.invalidateQueries({ queryKey: ['batchReview'] });
      queryClient.invalidateQueries({ queryKey: ['processing-summary'] });
      onVerified?.();
      onClose();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.detail || error.message || 'Failed to verify task';
      toast.error(message);
    },
  });

  // Delete image mutation
  const deleteMutation = useMutation({
    mutationFn: (imageId: string) => deleteTaskImage(projectId, imageId),
    onSuccess: () => {
      toast.success('Image deleted');
      refetch();
      setSelectedImageId(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.detail || error.message || 'Failed to delete image';
      toast.error(message);
    },
  });

  const getPopupUI = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_properties: Record<string, any>) => {
      if (!popupData) {
        return <div>Loading...</div>;
      }

      return (
        <div className="naxatw-flex naxatw-flex-col naxatw-gap-2 naxatw-max-w-[300px]">
          <p className="naxatw-text-sm naxatw-font-medium naxatw-truncate">
            {popupData.filename}
          </p>
          {(popupData.thumbnail_url || popupData.url) && (
            <img
              src={popupData.thumbnail_url || popupData.url}
              alt={popupData.filename}
              className="naxatw-w-full naxatw-h-auto naxatw-rounded"
            />
          )}
          <p className="naxatw-text-xs naxatw-capitalize">
            Status: {popupData.status?.replace('_', ' ')}
          </p>
          {popupData.rejection_reason && (
            <p className="naxatw-text-xs naxatw-text-red-500">
              Reason: {popupData.rejection_reason}
            </p>
          )}
        </div>
      );
    },
    [popupData],
  );

  const handleDeleteFromPopup = useCallback((data: Record<string, any>) => {
    if (data?.id) {
      deleteMutation.mutate(data.id);
    }
  }, [deleteMutation]);

  if (!isOpen) return null;

  const imageGeoJsonData = imagesGeoJson();
  const coveragePercentage = verificationData?.coverage_percentage ?? 0;
  const isLowCoverage = coveragePercentage < 100;

  return (
    <div className="naxatw-fixed naxatw-inset-0 naxatw-z-[9999] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-50">
      <div className="naxatw-relative naxatw-flex naxatw-h-[90vh] naxatw-w-[90vw] naxatw-flex-col naxatw-rounded-lg naxatw-bg-white naxatw-shadow-xl">
        {/* Header */}
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-border-b naxatw-px-6 naxatw-py-4">
          <div>
            <h2 className="naxatw-text-xl naxatw-font-semibold naxatw-text-gray-800">
              Verify Task #{taskIndex}
            </h2>
            <p className="naxatw-text-sm naxatw-text-gray-500">
              Review images on the map and verify coverage before processing
            </p>
          </div>
          <button
            onClick={onClose}
            className="naxatw-rounded-full naxatw-p-2 naxatw-text-gray-500 hover:naxatw-bg-gray-100"
          >
            <span className="material-icons">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="naxatw-flex naxatw-flex-1 naxatw-overflow-hidden">
          {isLoading ? (
            <div className="naxatw-flex naxatw-flex-1 naxatw-items-center naxatw-justify-center">
              <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-3">
                <div className="naxatw-h-8 naxatw-w-8 naxatw-animate-spin naxatw-rounded-full naxatw-border-4 naxatw-border-gray-200 naxatw-border-t-red" />
                <p className="naxatw-text-gray-500">Loading task data...</p>
              </div>
            </div>
          ) : (
            <>
              {/* Map Section */}
              <div className="naxatw-relative naxatw-flex-1">
                <MapContainer
                  ref={mapContainerRef}
                  map={map}
                  isMapLoaded={isMapLoaded}
                  containerId="task-verification-map"
                  style={{
                    width: '100%',
                    height: '100%',
                  }}
                >
                  <BaseLayerSwitcherUI />

                  {/* Task polygon */}
                  {map && isMapLoaded && isStyleReady && verificationData?.task_geometry && (
                    <VectorLayer
                      map={map}
                      isMapLoaded={isMapLoaded}
                      id="task-polygon"
                      geojson={taskGeoJsonData as GeojsonType}
                      visibleOnMap={true}
                      layerOptions={taskLayerOptions}
                      zoomToExtent
                    />
                  )}

                  {/* Task polygon outline */}
                  {map && isMapLoaded && isStyleReady && verificationData?.task_geometry && (
                    <VectorLayer
                      map={map}
                      isMapLoaded={isMapLoaded}
                      id="task-polygon-outline"
                      geojson={taskGeoJsonData as GeojsonType}
                      visibleOnMap={true}
                      layerOptions={taskOutlineLayerOptions}
                    />
                  )}

                  {/* Image points */}
                  {map && isMapLoaded && isStyleReady && imageGeoJsonData && imageGeoJsonData.features.length > 0 && (
                    <VectorLayer
                      map={map}
                      isMapLoaded={isMapLoaded}
                      id="task-image-points"
                      geojson={imageGeoJsonData as GeojsonType}
                      visibleOnMap={true}
                      layerOptions={imagePointLayerOptions}
                    />
                  )}

                  {/* Popup for image preview */}
                  <AsyncPopup
                    showPopup={(feature: Record<string, any>) =>
                      feature?.source === 'task-image-points'
                    }
                    popupUI={getPopupUI}
                    fetchPopupData={(properties: Record<string, any>) => {
                      setPopupData(properties);
                    }}
                    title="Image Preview"
                    buttonText="Delete"
                    handleBtnClick={handleDeleteFromPopup}
                    closePopupOnButtonClick
                  />
                </MapContainer>

                {/* Stats Overlay */}
                <div className="naxatw-absolute naxatw-left-4 naxatw-top-4 naxatw-z-10 naxatw-rounded-lg naxatw-bg-white naxatw-p-4 naxatw-shadow-lg">
                  <h4 className="naxatw-mb-2 naxatw-text-sm naxatw-font-semibold naxatw-text-gray-700">
                    Task Statistics
                  </h4>
                  <div className="naxatw-flex naxatw-flex-col naxatw-gap-1 naxatw-text-sm">
                    <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                      <span className="naxatw-text-gray-600">Images:</span>
                      <span className="naxatw-font-medium">
                        {verificationData?.image_count || 0}
                      </span>
                    </div>
                    <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                      <span className="naxatw-text-gray-600">Coverage:</span>
                      <span
                        className={`naxatw-font-medium ${
                          isLowCoverage ? 'naxatw-text-yellow-600' : 'naxatw-text-green-600'
                        }`}
                      >
                        {coveragePercentage.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Coverage Warning */}
                {isLowCoverage && (
                  <div className="naxatw-absolute naxatw-bottom-4 naxatw-left-4 naxatw-right-4 naxatw-z-10 naxatw-rounded-lg naxatw-border naxatw-border-yellow-300 naxatw-bg-yellow-50 naxatw-p-3">
                    <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                      <span className="material-icons naxatw-text-yellow-600">
                        warning
                      </span>
                      <div>
                        <p className="naxatw-text-sm naxatw-font-medium naxatw-text-yellow-800">
                          Low Coverage Warning
                        </p>
                        <p className="naxatw-text-xs naxatw-text-yellow-700">
                          This task has only {coveragePercentage.toFixed(0)}% coverage.
                          Consider uploading more images before marking as fully flown.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar - Image List */}
              <div className="naxatw-w-80 naxatw-border-l naxatw-overflow-y-auto">
                <div className="naxatw-p-4">
                  <h4 className="naxatw-mb-3 naxatw-text-sm naxatw-font-semibold naxatw-text-gray-700">
                    Images ({verificationData?.image_count || 0})
                  </h4>
                  <div className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-2">
                    {verificationData?.images.map((image) => (
                      <div
                        key={image.id}
                        className={`naxatw-group naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded naxatw-border naxatw-transition-all hover:naxatw-shadow-md ${
                          selectedImageId === image.id
                            ? 'naxatw-border-blue-500 naxatw-ring-2 naxatw-ring-blue-200'
                            : image.status === 'rejected' || image.status === 'invalid_exif'
                              ? 'naxatw-border-red-300 hover:naxatw-border-red-500'
                              : 'naxatw-border-gray-200'
                        }`}
                        onClick={() => setSelectedImageId(image.id)}
                        title={`${image.filename}${image.rejection_reason ? ` - ${image.rejection_reason}` : ''}`}
                      >
                        <img
                          src={image.thumbnail_url || image.url}
                          alt={image.filename}
                          className="naxatw-h-full naxatw-w-full naxatw-object-cover"
                          loading="lazy"
                        />
                        {(image.status === 'rejected' || image.status === 'invalid_exif') && (
                          <div
                            className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-red-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white"
                            title={image.rejection_reason}
                          >
                            Rejected
                          </div>
                        )}
                        <button
                          className="naxatw-absolute naxatw-right-1 naxatw-top-1 naxatw-rounded-full naxatw-bg-red-500 naxatw-p-1 naxatw-text-white naxatw-opacity-0 naxatw-transition-opacity hover:naxatw-bg-red-600 group-hover:naxatw-opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(image.id);
                          }}
                          title="Delete image"
                        >
                          <span className="material-icons naxatw-text-sm">
                            close
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-border-t naxatw-px-6 naxatw-py-4">
          <div className="naxatw-text-sm naxatw-text-gray-500">
            Click on image dots to preview. Delete any problematic images before verifying.
          </div>
          <FlexRow className="naxatw-gap-3">
            <Button
              variant="ghost"
              className="naxatw-border naxatw-border-gray-300"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              variant="ghost"
              className="naxatw-bg-green-600 naxatw-text-white hover:naxatw-bg-green-700 disabled:naxatw-opacity-50"
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending || !verificationData?.images.length}
              leftIcon={verifyMutation.isPending ? 'sync' : 'check_circle'}
            >
              {verifyMutation.isPending ? 'Verifying...' : 'Mark Fully Flown'}
            </Button>
          </FlexRow>
        </div>
      </div>
    </div>
  );
};

export default TaskVerificationModal;
