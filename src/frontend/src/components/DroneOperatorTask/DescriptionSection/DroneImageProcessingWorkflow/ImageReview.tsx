import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Map as MapLibreMap, NavigationControl, AttributionControl } from 'maplibre-gl';
import { getBatchReview, getBatchMapData, acceptImage, BatchReviewData, BatchMapData, TaskGroup, TaskGroupImage } from '@Services/classification';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import Accordion from '@Components/common/Accordion';
import { Button } from '@Components/RadixComponents/Button';
import { toast } from 'react-toastify';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import AsyncPopup from '@Components/common/MapLibreComponents/NewAsyncPopup';

interface ImageReviewProps {
  projectId: string;
  batchId: string;
}

const ImageReview = ({ projectId, batchId }: ImageReviewProps) => {
  const queryClient = useQueryClient();
  const [selectedImage, setSelectedImage] = useState<{
    id: string;
    url: string;
    filename: string;
    status: string;
    rejection_reason?: string;
  } | null>(null);
  const [popupData, setPopupData] = useState<Record<string, any>>();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const { data: reviewData, isLoading, error } = useQuery<BatchReviewData>({
    queryKey: ['batchReview', projectId, batchId],
    queryFn: () => getBatchReview(projectId, batchId),
    enabled: !!projectId && !!batchId,
  });

  const { data: mapData } = useQuery<BatchMapData>({
    queryKey: ['batchMapData', projectId, batchId],
    queryFn: () => getBatchMapData(projectId, batchId),
    enabled: !!projectId && !!batchId,
  });

  // Initialize map only after container is mounted
  useEffect(() => {
    if (!mapContainerRef.current || map) return;

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
    });

    // Disable rotation
    mapInstance.dragRotate.disable();
    mapInstance.touchZoomRotate.disableRotation();

    setMap(mapInstance);

    return () => {
      mapInstance.remove();
    };
  }, [reviewData]); // Only run when reviewData is available (meaning component is rendered)

  // Add map controls when loaded
  useEffect(() => {
    if (isMapLoaded && map) {
      map.addControl(new NavigationControl(), 'top-right');
      map.addControl(
        new AttributionControl({
          compact: true,
        }),
        'bottom-right',
      );
    }
  }, [isMapLoaded, map]);

  const acceptMutation = useMutation({
    mutationFn: (imageId: string) => acceptImage(projectId, imageId),
    onSuccess: (data) => {
      if (data.status === 'unmatched') {
        toast.warning(data.message);
      } else {
        toast.success('Image accepted successfully');
      }
      queryClient.invalidateQueries({ queryKey: ['batchReview', projectId, batchId] });
      queryClient.invalidateQueries({ queryKey: ['batchMapData', projectId, batchId] });
      setSelectedImage(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.detail || error.message || 'Failed to accept image';
      toast.error(message);
    },
  });

  const handleImageClick = (image: TaskGroupImage) => {
    setSelectedImage({
      id: image.id,
      url: image.url || image.thumbnail_url || '',
      filename: image.filename,
      status: image.status,
      rejection_reason: image.rejection_reason,
    });
  };

  const closeModal = () => {
    setSelectedImage(null);
  };

  const handleAcceptImage = () => {
    if (selectedImage) {
      acceptMutation.mutate(selectedImage.id);
    }
  };

  const getPopupUI = useCallback(() => {
    return (
      <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
        <p className="naxatw-text-sm naxatw-font-medium">{popupData?.filename || 'Unknown'}</p>
        <p className="naxatw-text-xs naxatw-capitalize">Status: {popupData?.status?.replace('_', ' ') || 'Unknown'}</p>
      </div>
    );
  }, [popupData]);

  if (isLoading) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-gray-500">Loading review data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-red-500">
          Error loading review data: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  if (!reviewData || reviewData.task_groups.length === 0) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-gray-500">
          No classified images available for review.
        </p>
      </div>
    );
  }

  const isRejectedImage = selectedImage && (selectedImage.status === 'rejected' || selectedImage.status === 'invalid_exif');

  return (
    <FlexColumn className="naxatw-gap-4 naxatw-h-full">
      {/* Map and List Split View */}
      <div className="naxatw-flex naxatw-flex-1 naxatw-gap-4 naxatw-min-h-0">
        {/* Map Section */}
        <div className="naxatw-w-1/2 naxatw-rounded naxatw-border naxatw-border-gray-300 naxatw-overflow-hidden naxatw-relative">
          <MapContainer
            ref={mapContainerRef}
            map={map}
            isMapLoaded={isMapLoaded}
            containerId="image-review-map"
            style={{
              width: '100%',
              height: '100%',
              minHeight: '400px',
            }}
          >
            <BaseLayerSwitcherUI />

            {/* Task polygons */}
            {map && isMapLoaded && mapData?.tasks && (
              <VectorLayer
                map={map}
                isMapLoaded={isMapLoaded}
                id="review-task-polygons"
                geojson={mapData.tasks as GeojsonType}
                visibleOnMap={true}
                layerOptions={{
                  type: 'fill',
                  paint: {
                    'fill-color': '#98BBC8',
                    'fill-outline-color': '#484848',
                    'fill-opacity': 0.4,
                  },
                }}
                zoomToExtent
              />
            )}

            {/* Task polygon outlines for better visibility */}
            {map && isMapLoaded && mapData?.tasks && (
              <VectorLayer
                map={map}
                isMapLoaded={isMapLoaded}
                id="review-task-outlines"
                geojson={mapData.tasks as GeojsonType}
                visibleOnMap={true}
                layerOptions={{
                  type: 'line',
                  paint: {
                    'line-color': '#484848',
                    'line-width': 2,
                  },
                }}
              />
            )}

            {/* Image point markers */}
            {map && isMapLoaded && mapData?.images && (
              <VectorLayer
                map={map}
                isMapLoaded={isMapLoaded}
                id="review-image-points"
                geojson={mapData.images as GeojsonType}
                visibleOnMap={true}
                layerOptions={{
                  type: 'circle',
                  paint: {
                    'circle-color': [
                      'match',
                      ['get', 'status'],
                      'assigned', '#22c55e',
                      'rejected', '#D73F3F',
                      'unmatched', '#eab308',
                      'invalid_exif', '#f97316',
                      'duplicate', '#6b7280',
                      '#3b82f6',
                    ],
                    'circle-radius': 5,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-opacity': 0.8,
                  },
                }}
              />
            )}

            {/* Popup for image points */}
            <AsyncPopup
              showPopup={(feature: Record<string, any>) =>
                feature?.source === 'review-image-points'
              }
              popupUI={getPopupUI}
              fetchPopupData={(properties: Record<string, any>) => {
                setPopupData(properties);
              }}
              title="Image Details"
              hideButton
            />
          </MapContainer>

          {/* Legend */}
          <div className="naxatw-absolute naxatw-bottom-8 naxatw-left-2 naxatw-z-10 naxatw-rounded naxatw-bg-white naxatw-p-2 naxatw-shadow-md">
            <p className="naxatw-text-xs naxatw-font-semibold naxatw-mb-1">Image Status</p>
            <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
              <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                <div className="naxatw-w-3 naxatw-h-3 naxatw-rounded-full" style={{ backgroundColor: '#22c55e' }} />
                <span className="naxatw-text-xs">Assigned</span>
              </div>
              <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                <div className="naxatw-w-3 naxatw-h-3 naxatw-rounded-full" style={{ backgroundColor: '#D73F3F' }} />
                <span className="naxatw-text-xs">Rejected</span>
              </div>
              <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                <div className="naxatw-w-3 naxatw-h-3 naxatw-rounded-full" style={{ backgroundColor: '#eab308' }} />
                <span className="naxatw-text-xs">Unmatched</span>
              </div>
              <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                <div className="naxatw-w-3 naxatw-h-3 naxatw-rounded-full" style={{ backgroundColor: '#f97316' }} />
                <span className="naxatw-text-xs">Invalid EXIF</span>
              </div>
            </div>
          </div>
        </div>

        {/* List Section */}
        <div className="naxatw-w-1/2 naxatw-overflow-y-auto naxatw-pr-2">
          <FlexRow className="naxatw-items-center naxatw-justify-between naxatw-mb-3">
            <p className="naxatw-text-sm naxatw-text-[#484848]">
              Review the classified images grouped by tasks.
            </p>
            <FlexRow className="naxatw-gap-3 naxatw-text-xs">
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">{reviewData.total_tasks}</span> Tasks
              </span>
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">{reviewData.total_images}</span> Images
              </span>
            </FlexRow>
          </FlexRow>

          {/* Task Accordions */}
          <div className="naxatw-flex naxatw-flex-col">
            {reviewData.task_groups.map((group: TaskGroup, index: number) => (
              <Accordion
                key={group.task_id || `task-${index}`}
                open={false}
                className="!naxatw-border-b !naxatw-border-gray-300 !naxatw-py-4"
                headerClassName="!naxatw-items-start"
                contentClassName="naxatw-mt-4"
                title={
                  <FlexRow className="naxatw-items-center naxatw-gap-3">
                    <h4 className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-900">
                      {group.task_id ? `Task #${group.project_task_index}` : 'Rejected Images'}
                    </h4>
                    <span className="naxatw-rounded-full naxatw-bg-blue-100 naxatw-px-3 naxatw-py-1 naxatw-text-sm naxatw-font-medium naxatw-text-blue-800">
                      {group.image_count} {group.image_count === 1 ? 'image' : 'images'}
                    </span>
                  </FlexRow>
                }
              >
                {/* Image Grid - Only loaded when accordion is open */}
                <div className="naxatw-grid naxatw-grid-cols-6 naxatw-gap-2">
                  {group.images.map((image) => (
                    <div
                      key={image.id}
                      className={`naxatw-group naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded naxatw-border naxatw-transition-all hover:naxatw-shadow-md ${
                        image.status === 'rejected' || image.status === 'invalid_exif'
                          ? 'naxatw-border-red-300 hover:naxatw-border-red-500'
                          : 'naxatw-border-gray-200 hover:naxatw-border-blue-500'
                      }`}
                      onClick={() => handleImageClick(image)}
                      title={image.filename}
                    >
                      <img
                        src={image.thumbnail_url || image.url}
                        alt={image.filename}
                        className="naxatw-h-full naxatw-w-full naxatw-object-cover"
                        loading="lazy"
                      />
                      {(image.status === 'rejected' || image.status === 'invalid_exif') && (
                        <div className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-red-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white">
                          Rejected
                        </div>
                      )}
                      <div className="naxatw-absolute naxatw-inset-0 naxatw-bg-black naxatw-opacity-0 naxatw-transition-opacity group-hover:naxatw-opacity-10" />
                    </div>
                  ))}
                </div>
              </Accordion>
            ))}
          </div>
        </div>
      </div>

      {/* Full Image Modal */}
      {selectedImage && (
        <div
          className="naxatw-fixed naxatw-inset-0 naxatw-z-[9999] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-75"
          onClick={closeModal}
        >
          <div className="naxatw-relative naxatw-max-h-[90vh] naxatw-max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <button
              className="naxatw-absolute naxatw-right-4 naxatw-top-4 naxatw-rounded-full naxatw-bg-white naxatw-p-2 naxatw-text-gray-800 naxatw-shadow-lg hover:naxatw-bg-gray-100"
              onClick={closeModal}
            >
              <span className="material-icons">close</span>
            </button>
            <img
              src={selectedImage.url}
              alt={selectedImage.filename}
              className="naxatw-max-h-[90vh] naxatw-max-w-[90vw] naxatw-rounded naxatw-object-contain"
            />
            <div className="naxatw-absolute naxatw-bottom-4 naxatw-left-4 naxatw-right-4 naxatw-flex naxatw-items-center naxatw-justify-between">
              <div className="naxatw-rounded naxatw-bg-black naxatw-bg-opacity-75 naxatw-px-4 naxatw-py-2 naxatw-text-white">
                <p>{selectedImage.filename}</p>
                {isRejectedImage && selectedImage.rejection_reason && (
                  <p className="naxatw-text-sm naxatw-text-red-300">
                    Reason: {selectedImage.rejection_reason}
                  </p>
                )}
              </div>
              {isRejectedImage && (
                <Button
                  variant="ghost"
                  className="naxatw-bg-green-600 naxatw-text-white hover:naxatw-bg-green-700"
                  onClick={handleAcceptImage}
                  disabled={acceptMutation.isPending}
                  leftIcon="check"
                >
                  {acceptMutation.isPending ? 'Accepting...' : 'Mark as Good'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </FlexColumn>
  );
};

export default ImageReview;
