import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Map as MapLibreMap, NavigationControl, AttributionControl } from 'maplibre-gl';
import { toast } from 'react-toastify';
import {
  FlightGapDetectionData,
  getFlightGapDetectionData,
} from '@Services/classification';
import { FlexRow } from '@Components/common/Layouts';
import { Button } from '@Components/RadixComponents/Button';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import AsyncPopup from '@Components/common/MapLibreComponents/NewAsyncPopup';

interface FlightGapDetectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  taskId: string;
  taskIndex: number;
  gapAnalysisData: FlightGapDetectionData | null;
}

const FlightGapDetectionModal = ({
  isOpen,
  onClose,
  projectId,
  taskId,
  taskIndex,
  gapAnalysisData
}: FlightGapDetectionModalProps) => {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isStyleReady, setIsStyleReady] = useState(false);
   const [isDownloadReady, setIsDownloadReady] = useState(false);
  const [popupData, setPopupData] = useState<Record<string, any>>();
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [manualGapData, setmanualGapData] = useState<GeoJSON.FeatureCollection | null>(null);

  // Reset map when modal closes
  useEffect(() => {
    if (!isOpen && map) {
      map.remove();
      setMap(null);
      setIsMapLoaded(false);
      setIsStyleReady(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!manualGapData && gapAnalysisData) {
      setmanualGapData(gapAnalysisData.gap_polygons);
    }
  }, [gapAnalysisData]);

  // Initialize map after data is loaded and DOM is ready
  useEffect(() => {
    if (!isOpen || !gapAnalysisData || map) return;

    // Use a small delay to ensure DOM is rendered after loading state changes
    const timer = setTimeout(() => {
      const container = document.getElementById('flight-gap-analysis-map');
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
    }, 100);

    return () => clearTimeout(timer);
  }, [isOpen]);

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
  const imagesGeoJson = useCallback(() => {
    if (!gapAnalysisData?.images) return null;

    const features = gapAnalysisData.images.features.flatMap((img) => {
      const properties = img.properties;
      if (!properties || !img.geometry || img.geometry.type !== 'Point') {
        return [];
      }

      return [{
        type: 'Feature' as const,
        properties: {
          id: properties.id,
          filename: properties.filename,
          status: properties.status,
          thumbnail_url: properties.thumbnail_url,
          url: properties.url,
        },
        geometry: img.geometry,
      }];
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [gapAnalysisData]);

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
        </div>
      );
    },
    [popupData],
  );

  // Manual gaps modified and finalized by user
  const finalizeGapMutation = useMutation({
      mutationFn: (gap_polygons: GeoJSON.FeatureCollection) =>
        getFlightGapDetectionData(projectId, taskId, gap_polygons),
      onSuccess: () => {
        toast.success('Gaps Finalized and Reconstructed Flight Plan available.');
        setIsDownloadReady(true);
        setmanualGapData(null);
      },
      onError: (error: any) => {
        const message = error?.response?.data?.detail || error.message || 'Failed to finalize gaps';
        toast.error(message);
      },
    });

  const handleFinalizeGaps = () => {
    if (manualGapData) {
      finalizeGapMutation.mutate(manualGapData);
    }
    else {
      toast.error("Gap Polygons not found.");
    }
  }

  const handleDownloadPlan = () => {
    if (gapAnalysisData?.flightplan_url) {
      window.location.assign(gapAnalysisData.flightplan_url);
    }
     else {
      toast.error("Flight Plan URL not found.");
    }
  }

  if (!isOpen || !gapAnalysisData) return null;

  const imageGeoJsonData = imagesGeoJson();
  const taskGeometryGeoJson = {
    type: 'FeatureCollection' as const,
    features: [gapAnalysisData.task_geometry],
  } as unknown as GeojsonType;

  return (
    <div className="naxatw-fixed naxatw-inset-0 naxatw-z-[9999] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-50">
      <div className="naxatw-relative naxatw-flex naxatw-h-[90vh] naxatw-w-[90vw] naxatw-flex-col naxatw-rounded-lg naxatw-bg-white naxatw-shadow-xl">
        {/* Header */}
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-border-b naxatw-px-6 naxatw-py-4">
          <div>
            <h2 className="naxatw-text-xl naxatw-font-semibold naxatw-text-gray-800">
              Flight Gap Analysis for Task: #{taskIndex}
            </h2>
            <p className="naxatw-text-sm naxatw-text-gray-500">
              Review and finalize gaps before processing a reconstructed flight plan.
            </p>
          </div>
          <button
            onClick={onClose}
            className="naxatw-rounded-full naxatw-p-2 naxatw-text-gray-500 hover:naxatw-bg-gray-100"
          >
            <span className="material-icons">close</span>
          </button>
        </div>

        <div className="naxatw-flex naxatw-flex-1 naxatw-overflow-hidden">
        {/* Map Section */}
        <div className="naxatw-relative naxatw-flex-1">
          <MapContainer
            map={map}
            isMapLoaded={isMapLoaded}
            containerId="flight-gap-analysis-map"
            style={{
              width: '100%',
              height: '100%',
            }}
          >
            <BaseLayerSwitcherUI />
            {/* Task polygon */}
            {map && isMapLoaded && isStyleReady && gapAnalysisData?.task_geometry && (
              <VectorLayer
                map={map}
                isMapLoaded={isMapLoaded}
                id="task-polygon"
                geojson={taskGeometryGeoJson}
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

            {/* Task polygon outline */}
            {map && isMapLoaded && isStyleReady && gapAnalysisData?.task_geometry && (
              <VectorLayer
                map={map}
                isMapLoaded={isMapLoaded}
                id="task-polygon-outline"
                geojson={taskGeometryGeoJson}
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

            {/* Gap Polygons */}
            {map && isMapLoaded && isStyleReady && gapAnalysisData?.gap_polygons && (
              <VectorLayer
                map={map}
                isMapLoaded={isMapLoaded}
                id="task-gap-polygons"
                geojson={ gapAnalysisData.gap_polygons as GeojsonType}
                visibleOnMap={true}
                layerOptions={{
                  type: 'fill',
                  paint: {
                    'fill-color': '#f32424',
                    'fill-opacity': 0.4,
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
                hideButton
              />
            </MapContainer>
            </div>

            {/* Sidebar - Image List */}
            <div className="naxatw-w-80 naxatw-border-l naxatw-overflow-y-auto">
              <div className="naxatw-p-4">
                <h4 className="naxatw-mb-3 naxatw-text-sm naxatw-font-semibold naxatw-text-gray-700">
                  Images ({gapAnalysisData?.images?.features?.length || 0})
                </h4>
                <div className="naxatw-grid naxatw-grid-cols-2 naxatw-gap-2">
                  {gapAnalysisData?.images.features.map((image, index) => {
                    const properties = image.properties ?? {};
                    const imageId = String(properties.id ?? index);

                    return (
                      <div
                        key={imageId}
                        className={`naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded naxatw-border naxatw-transition-all hover:naxatw-shadow-md ${
                          selectedImageId === imageId
                            ? 'naxatw-border-blue-500 naxatw-ring-2 naxatw-ring-blue-200'
                            : 'naxatw-border-gray-200'
                        }`}
                        onClick={() => setSelectedImageId(imageId)}
                      >
                        <img
                          src={String(properties.thumbnail_url || properties.url || '')}
                          alt={String(properties.filename || 'Task image')}
                          className="naxatw-h-full naxatw-w-full naxatw-object-cover"
                          loading="lazy"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

        {/* Footer */}
        <div className="naxatw-flex naxatw-items-center naxatw-justify-between naxatw-border-t naxatw-px-6 naxatw-py-4">
          <div className="naxatw-text-sm naxatw-text-gray-500">
            Modify any gaps to the flightplan before finalizing a reconstructed flightplan.
          </div>
          <FlexRow className="naxatw-gap-3">
            <Button
              variant="ghost"
              className="naxatw-border naxatw-border-gray-300"
              onClick={onClose}
            >
              Cancel
            </Button>
            {isDownloadReady ?
            (
              <Button
                variant="ghost"
                className="naxatw-border naxatw-border-gray-300"
                onClick={handleDownloadPlan}
              >
                Download Flight Plan
              </Button>
              )
               :
               (
                <Button
                variant="ghost"
                className="naxatw-border naxatw-border-gray-300"
                onClick={handleFinalizeGaps}
              >
                Finalize Gaps
                </Button>
                )}
          </FlexRow>
        </div>
      </div>
    </div>
  )
};

export default FlightGapDetectionModal;
