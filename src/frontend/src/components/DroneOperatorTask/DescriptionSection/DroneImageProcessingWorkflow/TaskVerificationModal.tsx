import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Map as MapLibreMap, NavigationControl, AttributionControl, LngLatBoundsLike, Popup } from 'maplibre-gl';
import bbox from '@turf/bbox';
import { toast } from 'react-toastify';
import {
  getProjectTaskVerificationData,
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

interface TaskVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  taskId: string;
  taskIndex: number;
  onVerified?: () => void;
}

const TaskVerificationModal = ({
  isOpen,
  onClose,
  projectId,
  taskId,
  taskIndex,
  onVerified,
}: TaskVerificationModalProps) => {
  const queryClient = useQueryClient();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isStyleReady, setIsStyleReady] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const imageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hasFitRef = useRef(false);

  // Fetch task verification data (project-level, across all batches)
  const { data: verificationData, isLoading, refetch } = useQuery<TaskVerificationData>({
    queryKey: ['taskVerification', projectId, taskId],
    queryFn: () => getProjectTaskVerificationData(projectId, taskId),
    enabled: isOpen && !!projectId && !!taskId,
  });

  // Reset map when modal closes
  useEffect(() => {
    if (!isOpen && map) {
      map.remove();
      setMap(null);
      setIsMapLoaded(false);
      setIsStyleReady(false);
      hasFitRef.current = false;
    }
  }, [isOpen]);

  // Initialize map after data is loaded and DOM is ready
  useEffect(() => {
    if (!isOpen || !verificationData || map) return;

    const timer = setTimeout(() => {
      const container = document.getElementById('task-verification-map');
      if (!container) {
        console.error('Map container not found');
        return;
      }

      const mapInstance = new MapLibreMap({
        container: container,
        style: { version: 8, sources: {}, layers: [] },
        center: [0, 0],
        zoom: 2,
        maxZoom: 22,
        attributionControl: false,
        renderWorldCopies: false,
      });

      mapInstance.on('load', () => {
        setIsMapLoaded(true);
        setTimeout(() => {
          if (mapInstance.getStyle()) {
            setIsStyleReady(true);
          }
        }, 100);
      });

      mapInstance.dragRotate.disable();
      mapInstance.touchZoomRotate.disableRotation();

      setMap(mapInstance);
    }, 100);

    return () => clearTimeout(timer);
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

  // Fit to task extent with appropriate zoom (not too close)
  useEffect(() => {
    if (!map || !isMapLoaded || !isStyleReady || !verificationData?.task_geometry || hasFitRef.current) return;
    hasFitRef.current = true;

    try {
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [verificationData.task_geometry],
      };
      const [minLng, minLat, maxLng, maxLat] = bbox(geojson);
      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]] as LngLatBoundsLike,
        {
          padding: 60,
          maxZoom: 17,
          duration: 300,
        }
      );
    } catch {
      // ignore
    }
  }, [map, isMapLoaded, isStyleReady, verificationData]);

  // Pointer cursor + click handler on image points
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = 'task-image-points-layer';

    const onMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    const handleClick = (e: any) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
      if (!features?.length) return;

      const props = features[0].properties;
      const coords = (features[0].geometry as any).coordinates.slice();

      // Close existing popup
      if (popupRef.current) {
        popupRef.current.remove();
      }

      const html = `
        <div style="min-width:160px;max-width:280px;font-family:system-ui,sans-serif;">
          <p style="font-size:13px;font-weight:600;margin-bottom:4px;word-break:break-all;">${props.filename}</p>
          ${(props.thumbnail_url || props.url)
            ? `<img src="${props.thumbnail_url || props.url}" style="width:100%;height:auto;border-radius:4px;margin-bottom:4px;" />`
            : ''}
          <p style="font-size:12px;color:#555;text-transform:capitalize;">Status: ${(props.status || '').replace('_', ' ')}</p>
        </div>
      `;

      const newPopup = new Popup({
        closeButton: true,
        closeOnClick: false,
        offset: 12,
        anchor: 'bottom',
        maxWidth: '300px',
      })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);

      popupRef.current = newPopup;

      // Highlight in sidebar
      setSelectedImageId(props.id);
      setTimeout(() => {
        const el = imageRefs.current[props.id];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    };

    map.on('mouseenter', layerId, onMouseEnter);
    map.on('mouseleave', layerId, onMouseLeave);
    map.on('click', layerId, handleClick);

    return () => {
      map.off('mouseenter', layerId, onMouseEnter);
      map.off('mouseleave', layerId, onMouseLeave);
      map.off('click', layerId, handleClick);
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, [map, isMapLoaded]);

  // Update map highlight when selectedImageId changes
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = 'task-image-points-layer';

    try {
      if (!map.getLayer(layerId)) return;

      if (selectedImageId) {
        map.setPaintProperty(layerId, 'circle-stroke-width', [
          'case',
          ['==', ['get', 'id'], selectedImageId],
          4,
          2,
        ]);
        map.setPaintProperty(layerId, 'circle-stroke-color', [
          'case',
          ['==', ['get', 'id'], selectedImageId],
          '#2563eb',
          '#ffffff',
        ]);
        map.setPaintProperty(layerId, 'circle-radius', [
          'case',
          ['==', ['get', 'id'], selectedImageId],
          8,
          6,
        ]);
      } else {
        map.setPaintProperty(layerId, 'circle-stroke-width', 2);
        map.setPaintProperty(layerId, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(layerId, 'circle-radius', 6);
      }
    } catch {
      // Layer not ready yet
    }
  }, [map, isMapLoaded, selectedImageId]);

  // Convert images to GeoJSON for map display
  const imagesGeoJson = useCallback(() => {
    if (!verificationData?.images) return null;

    const features = verificationData.images
      .filter((img) => img.location?.coordinates)
      .map((img) => ({
        type: 'Feature' as const,
        properties: {
          id: img.id,
          filename: img.filename,
          status: img.status,
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

  // Mark as verified mutation
  const verifyMutation = useMutation({
    mutationFn: () => markTaskAsVerified(projectId, taskId),
    onSuccess: () => {
      toast.success(`Task #${taskIndex} marked as fully flown`);
      queryClient.invalidateQueries({ queryKey: ['taskVerification'] });
      queryClient.invalidateQueries({ queryKey: ['projectReview', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projectMapData', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
      queryClient.invalidateQueries({
        queryKey: ['projectTaskImagerySummary', projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ['all-task-assets-info', projectId],
      });
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

  // Handle sidebar image click: highlight on map and fly to point
  const handleSidebarImageClick = (imageId: string) => {
    setSelectedImageId(imageId);

    if (map && verificationData?.images) {
      const img = verificationData.images.find(i => i.id === imageId);
      if (img?.location?.coordinates) {
        const coords = img.location.coordinates as [number, number];

        // Close existing popup
        if (popupRef.current) {
          popupRef.current.remove();
        }

        const html = `
          <div style="min-width:160px;max-width:280px;font-family:system-ui,sans-serif;">
            <p style="font-size:13px;font-weight:600;margin-bottom:4px;word-break:break-all;">${img.filename}</p>
            ${(img.thumbnail_url || img.url)
              ? `<img src="${img.thumbnail_url || img.url}" style="width:100%;height:auto;border-radius:4px;margin-bottom:4px;" />`
              : ''}
            <p style="font-size:12px;color:#555;text-transform:capitalize;">Status: ${(img.status || '').replace('_', ' ')}</p>
          </div>
        `;

        const newPopup = new Popup({
          closeButton: true,
          closeOnClick: false,
          offset: 12,
          anchor: 'bottom',
          maxWidth: '300px',
        })
          .setLngLat(coords)
          .setHTML(html)
          .addTo(map);

        popupRef.current = newPopup;

        map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 17), duration: 500 });
      }
    }
  };

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
                      geojson={{
                        type: 'FeatureCollection',
                        features: [verificationData.task_geometry],
                      } as GeojsonType}
                      visibleOnMap={true}
                      layerOptions={{
                        type: 'fill',
                        paint: {
                          'fill-color': '#98BBC8',
                          'fill-outline-color': '#484848',
                          'fill-opacity': 0.4,
                        },
                      }}
                    />
                  )}

                  {/* Task polygon outline */}
                  {map && isMapLoaded && isStyleReady && verificationData?.task_geometry && (
                    <VectorLayer
                      map={map}
                      isMapLoaded={isMapLoaded}
                      id="task-polygon-outline"
                      geojson={{
                        type: 'FeatureCollection',
                        features: [verificationData.task_geometry],
                      } as GeojsonType}
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

                  {/* Image points */}
                  {map && isMapLoaded && isStyleReady && imageGeoJsonData && imageGeoJsonData.features.length > 0 && (
                    <VectorLayer
                      map={map}
                      isMapLoaded={isMapLoaded}
                      id="task-image-points"
                      geojson={imageGeoJsonData as GeojsonType}
                      visibleOnMap={true}
                      layerOptions={{
                        type: 'circle',
                        paint: {
                          'circle-color': '#22c55e',
                          'circle-radius': 6,
                          'circle-stroke-width': 2,
                          'circle-stroke-color': '#ffffff',
                          'circle-stroke-opacity': 0.8,
                        },
                      }}
                    />
                  )}
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
                        ref={(el) => { imageRefs.current[image.id] = el; }}
                        className={`naxatw-group naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded naxatw-border-2 naxatw-transition-all hover:naxatw-shadow-md ${
                          selectedImageId === image.id
                            ? 'naxatw-border-blue-500 naxatw-ring-2 naxatw-ring-blue-200'
                            : 'naxatw-border-gray-200'
                        }`}
                        onClick={() => handleSidebarImageClick(image.id)}
                      >
                        <img
                          src={image.thumbnail_url || image.url}
                          alt={image.filename}
                          className="naxatw-h-full naxatw-w-full naxatw-object-cover"
                          loading="lazy"
                        />
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
            Click on image dots to preview. Click thumbnails to highlight on map.
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
