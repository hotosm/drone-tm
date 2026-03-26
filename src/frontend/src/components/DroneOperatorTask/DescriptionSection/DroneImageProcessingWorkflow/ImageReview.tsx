import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Map as MapLibreMap, NavigationControl, AttributionControl, LngLatBoundsLike, Popup } from 'maplibre-gl';
import bbox from '@turf/bbox';
import { getProjectReview, getProjectMapData, acceptImage, ProjectReviewData, ProjectMapData, TaskGroup, TaskGroupImage, getBatchReview, getBatchMapData } from '@Services/classification';
import { FlexColumn, FlexRow } from '@Components/common/Layouts';
import Accordion from '@Components/common/Accordion';
import { Button } from '@Components/RadixComponents/Button';
import { toast } from 'react-toastify';
import MapContainer from '@Components/common/MapLibreComponents/MapContainer';
import VectorLayer from '@Components/common/MapLibreComponents/Layers/VectorLayer';
import BaseLayerSwitcherUI from '@Components/common/BaseLayerSwitcher';
import { GeojsonType } from '@Components/common/MapLibreComponents/types';
import TaskVerificationModal from './TaskVerificationModal';

interface ImageReviewProps {
  projectId: string;
  batchId?: string;  // Optional: when provided, shows batch-scoped data (upload step 3); when absent, shows project-level data (verify dialog)
}

const hasIssueStatus = (status?: string) => status !== 'assigned';

const ImageReview = ({ projectId, batchId }: ImageReviewProps) => {
  const queryClient = useQueryClient();
  const hasFitBoundsRef = useRef(false);
  const popupRef = useRef<Popup | null>(null);
  const [showOnlyIssueImages, setShowOnlyIssueImages] = useState(false);

  // Use project-level endpoints when no batchId (verify dialog), batch-scoped when batchId is present (upload step 3)
  // Both return the same shape (tasks FeatureCollection, images FeatureCollection, counts)
  const {
    data: mapData,
    isLoading: isMapDataLoading,
    error: mapDataError,
    isError: isMapDataError
  } = useQuery<ProjectMapData>({
    queryKey: batchId ? ['batchMapData', projectId, batchId] : ['projectMapData', projectId],
    queryFn: () => (batchId ? getBatchMapData(projectId, batchId) : getProjectMapData(projectId)) as Promise<ProjectMapData>,
    enabled: !!projectId,
  });

  const {
    data: reviewData,
    isLoading: isReviewLoading,
    error: reviewError,
    isError: isReviewError
  } = useQuery<ProjectReviewData>({
    queryKey: batchId ? ['batchReview', projectId, batchId] : ['projectReview', projectId],
    queryFn: () => (batchId ? getBatchReview(projectId, batchId) : getProjectReview(projectId)) as Promise<ProjectReviewData>,
    enabled: !!projectId,
  });

  const isLoading = isMapDataLoading || isReviewLoading;
  const error = isMapDataError ? mapDataError : (isReviewError ? reviewError : null);

  // Reset fit bounds when data source changes
  useEffect(() => {
    hasFitBoundsRef.current = false;
  }, [batchId, projectId]);

  const [selectedImage, setSelectedImage] = useState<{
    id: string;
    url: string;
    filename: string;
    status: string;
    rejection_reason?: string;
  } | null>(null);
  const [highlightedImageId, setHighlightedImageId] = useState<string | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [verificationModal, setVerificationModal] = useState<{
    isOpen: boolean;
    taskId: string;
    taskIndex: number;
  }>({
    isOpen: false,
    taskId: '',
    taskIndex: 0,
  });

  // Refs for sidebar scrolling
  const imageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Detect when container is ready
  const mapContainerRefCallback = useCallback((node: HTMLDivElement | null) => {
      if (node !== null) {
          setContainer(node);
      }
  }, []);

  // Initialize map when container is ready
  useEffect(() => {
    if (!container || map) {
        return;
    }

    const mapInstance = new MapLibreMap({
      container: container,
      style: { version: 8, sources: {}, layers: [] },
      center: [0, 0],
      zoom: 1,
      maxZoom: 22,
      attributionControl: false,
      renderWorldCopies: false,
      preserveDrawingBuffer: true,
      trackResize: true,
    });

    mapInstance.setStyle({ version: 8, sources: {}, layers: [] });

    mapInstance.on('load', () => {
      setIsMapLoaded(true);
      mapInstance.resize();
    });

    // Disable rotation
    mapInstance.dragRotate.disable();
    mapInstance.touchZoomRotate.disableRotation();

    setMap(mapInstance);

    return () => {
       if (mapInstance) {
         try {
           mapInstance.remove();
         } catch (e) {
           console.warn('Error removing map instance:', e);
         }
       }
    };
  }, [container]); // Re-run when container becomes available

  // Observe container resize events
  useEffect(() => {
    if (!map || !container) return;

    const observer = new ResizeObserver(() => {
       if (map) {
          map.resize();
       }
    });

    observer.observe(container);

    return () => {
        observer.disconnect();
    }
  }, [map, container]);

  // Fit map to task extent when ready
  useEffect(() => {
    if (!map || !isMapLoaded || !mapData?.tasks || hasFitBoundsRef.current) return;
    hasFitBoundsRef.current = true;
    try {
      const [minLng, minLat, maxLng, maxLat] = bbox(mapData.tasks);
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]] as LngLatBoundsLike, {
        padding: 40,
        maxZoom: 18,
        duration: 300,
      });
    } catch {
      // ignore invalid geometry
    }
  }, [map, isMapLoaded, mapData]);

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

  // Pointer cursor on image point hover
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = 'review-image-points-layer';

    const onMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('mouseenter', layerId, onMouseEnter);
    map.on('mouseleave', layerId, onMouseLeave);

    return () => {
      map.off('mouseenter', layerId, onMouseEnter);
      map.off('mouseleave', layerId, onMouseLeave);
    };
  }, [map, isMapLoaded]);

  // Custom popup on map click (replaces AsyncPopup for reliable close behavior)
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = 'review-image-points-layer';

    const handleClick = (e: any) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
      if (!features?.length) return;

      const props = features[0].properties;
      const coords = (features[0].geometry as any).coordinates.slice();

      // Close existing popup
      if (popupRef.current) {
        popupRef.current.remove();
      }

      const statusColors: Record<string, string> = {
        assigned: '#22c55e',
        rejected: '#D73F3F',
        unmatched: '#eab308',
        invalid_exif: '#f97316',
        duplicate: '#6b7280',
      };
      const dotColor = statusColors[props.status] || '#3b82f6';

      const html = `
        <div style="min-width:180px;max-width:280px;font-family:system-ui,sans-serif;">
          <div style="font-size:13px;font-weight:600;margin-bottom:4px;word-break:break-all;">${props.filename || 'Unknown'}</div>
          <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#555;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};"></span>
            ${(props.status || 'unknown').replace('_', ' ')}
          </div>
          ${props.rejection_reason ? `<div style="font-size:11px;color:#b91c1c;margin-top:4px;">${props.rejection_reason}</div>` : ''}
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

      // Highlight the clicked image in sidebar
      setHighlightedImageId(props.id);

      // Scroll to the image in the sidebar
      setTimeout(() => {
        const el = imageRefs.current[props.id];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    };

    map.on('click', layerId, handleClick);

    return () => {
      map.off('click', layerId, handleClick);
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, [map, isMapLoaded]);

  // Update map highlight when highlightedImageId changes
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = 'review-image-points-layer';

    try {
      if (!map.getLayer(layerId)) return;

      if (highlightedImageId) {
        map.setPaintProperty(layerId, 'circle-stroke-width', [
          'case',
          ['==', ['get', 'id'], highlightedImageId],
          4,
          2,
        ]);
        map.setPaintProperty(layerId, 'circle-stroke-color', [
          'case',
          ['==', ['get', 'id'], highlightedImageId],
          '#2563eb',
          '#ffffff',
        ]);
        map.setPaintProperty(layerId, 'circle-radius', [
          'case',
          ['==', ['get', 'id'], highlightedImageId],
          8,
          5,
        ]);
      } else {
        map.setPaintProperty(layerId, 'circle-stroke-width', 2);
        map.setPaintProperty(layerId, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(layerId, 'circle-radius', 5);
      }
    } catch {
      // Layer might not exist yet
    }
  }, [map, isMapLoaded, highlightedImageId]);

  const acceptMutation = useMutation({
    mutationFn: (imageId: string) => acceptImage(projectId, imageId),
    onSuccess: (data) => {
      if (data.status === 'unmatched') {
        toast.warning(data.message);
      } else {
        toast.success('Image accepted successfully');
      }
      // Invalidate both batch-scoped and project-level queries
      if (batchId) {
        queryClient.invalidateQueries({ queryKey: ['batchReview', projectId, batchId] });
        queryClient.invalidateQueries({ queryKey: ['batchMapData', projectId, batchId] });
      }
      queryClient.invalidateQueries({ queryKey: ['projectReview', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projectMapData', projectId] });
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

  // Handle sidebar thumbnail click: highlight on map and fly to it
  const handleSidebarImageClick = (image: TaskGroupImage) => {
    setHighlightedImageId(image.id);

    // Find the image's coordinates on the map and fly to it
    if (map && mapData?.images?.features) {
      const feature = mapData.images.features.find(
        (f: GeoJSON.Feature<any>) => f.properties?.id === image.id && f.geometry
      );
      if (feature && feature.geometry && 'coordinates' in feature.geometry) {
        const coords = (feature.geometry as GeoJSON.Point).coordinates;

        // Close existing popup
        if (popupRef.current) {
          popupRef.current.remove();
        }

        const statusColors: Record<string, string> = {
          assigned: '#22c55e',
          rejected: '#D73F3F',
          unmatched: '#eab308',
          invalid_exif: '#f97316',
          duplicate: '#6b7280',
        };
        const dotColor = statusColors[image.status] || '#3b82f6';

        const html = `
          <div style="min-width:180px;max-width:280px;font-family:system-ui,sans-serif;">
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;word-break:break-all;">${image.filename || 'Unknown'}</div>
            <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#555;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};"></span>
              ${(image.status || 'unknown').replace('_', ' ')}
            </div>
            ${image.rejection_reason ? `<div style="font-size:11px;color:#b91c1c;margin-top:4px;">${image.rejection_reason}</div>` : ''}
          </div>
        `;

        const newPopup = new Popup({
          closeButton: true,
          closeOnClick: false,
          offset: 12,
          anchor: 'bottom',
          maxWidth: '300px',
        })
          .setLngLat(coords as [number, number])
          .setHTML(html)
          .addTo(map);

        popupRef.current = newPopup;

        map.flyTo({ center: coords as [number, number], zoom: Math.max(map.getZoom(), 16), duration: 500 });
      }
    }
  };

  const closeModal = () => {
    setSelectedImage(null);
  };

  const handleAcceptImage = () => {
    if (selectedImage) {
      acceptMutation.mutate(selectedImage.id);
    }
  };

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
  const isDuplicateImage = selectedImage && selectedImage.status === 'duplicate';

  const locatedImages = mapData?.images?.features?.filter(
    (feature: GeoJSON.Feature<any>) => feature.geometry !== null,
  ) || [];

  // Collect unlocated images with their thumbnail data from map API
  const unlocatedImages = mapData?.images?.features?.filter(
    (feature: GeoJSON.Feature<any>) => feature.geometry === null,
  ) || [];

  const filteredLocatedImages = showOnlyIssueImages
    ? locatedImages.filter((feature: GeoJSON.Feature<any>) => hasIssueStatus(feature.properties?.status))
    : locatedImages;

  const filteredUnlocatedImages = showOnlyIssueImages
    ? unlocatedImages.filter((feature: GeoJSON.Feature<any>) => hasIssueStatus(feature.properties?.status))
    : unlocatedImages;

  const locatedImagesGeojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: filteredLocatedImages as GeoJSON.Feature<any>[],
  };

  const displayedTaskGroups = reviewData.task_groups
    .map((group: TaskGroup) => {
      const filteredImages = showOnlyIssueImages
        ? group.images.filter((image) => hasIssueStatus(image.status))
        : group.images;

      if (group.task_id) {
        return {
          ...group,
          images: filteredImages,
        };
      }

      const mergedUnlocatedImages = filteredUnlocatedImages
        .filter((feature: GeoJSON.Feature<any>) => !group.images.some((img) => img.id === feature.properties?.id))
        .map((feature: GeoJSON.Feature<any>) => {
          const props = feature.properties || {};
          return {
            id: props.id,
            filename: props.filename || 'Unknown',
            s3_key: props.s3_key || '',
            thumbnail_url: props.thumbnail_url,
            url: props.url,
            status: props.status || 'unknown',
            rejection_reason: props.rejection_reason || 'No GPS',
            uploaded_at: props.uploaded_at || '',
          };
        });

      return {
        ...group,
        images: [...filteredImages, ...mergedUnlocatedImages],
      };
    })
    .filter((group: TaskGroup) => !showOnlyIssueImages || group.images.length > 0);

  const totalIssueImages = (() => {
    const groupedIssueCount = reviewData.task_groups.reduce(
      (count: number, group: TaskGroup) => count + group.images.filter((image) => hasIssueStatus(image.status)).length,
      0,
    );
    const rejectedGroup = reviewData.task_groups.find((group: TaskGroup) => group.task_id === null);
    const extraUnlocatedIssueCount = unlocatedImages.filter((feature: GeoJSON.Feature<any>) => {
      if (!hasIssueStatus(feature.properties?.status)) {
        return false;
      }
      if (!rejectedGroup) {
        return true;
      }
      return !rejectedGroup.images.some((image) => image.id === feature.properties?.id);
    }).length;

    return groupedIssueCount + extraUnlocatedIssueCount;
  })();

  const visibleTaskCount = displayedTaskGroups.filter((group: TaskGroup) => group.task_id).length;

  return (
    <FlexColumn className="naxatw-gap-4 naxatw-h-full">
      {/* Map and List Split View */}
      <div className="naxatw-flex naxatw-flex-1 naxatw-gap-4 naxatw-min-h-0 naxatw-overflow-hidden">
        {/* Map Section */}
        <div className="naxatw-w-1/2 naxatw-rounded naxatw-border naxatw-border-gray-300 naxatw-overflow-hidden naxatw-relative naxatw-flex naxatw-flex-col">
          {/* Map Container */}
          <div className="naxatw-flex-1 naxatw-relative" style={{ display: 'flex', flexDirection: 'column', minHeight: '400px' }}>
          <MapContainer
            ref={mapContainerRefCallback}
            map={map}
            isMapLoaded={isMapLoaded}
            containerId="image-review-map"
            style={{
              width: '100%',
              height: '100%',
              flex: 1,
            }}
          >
            <BaseLayerSwitcherUI />

            {/* Task polygons */}
            {map && isMapLoaded && mapData?.tasks && (
              <VectorLayer
                key={`task-polygons-${mapData?.total_images_with_gps || 'pending'}`}
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
              />
            )}

            {/* Task polygon outlines for better visibility */}
            {map && isMapLoaded && mapData?.tasks && (
              <VectorLayer
                key={`task-outlines-${mapData?.total_images_with_gps || 'pending'}`}
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
            {map && isMapLoaded && locatedImagesGeojson?.features?.length > 0 && (
              <VectorLayer
                key={`image-points-${mapData?.total_images_with_gps}`}
                map={map}
                isMapLoaded={isMapLoaded}
                id="review-image-points"
                geojson={locatedImagesGeojson as GeojsonType}
                visibleOnMap={true}
                layerOptions={{
                  type: 'circle',
                  layout: {
                    'circle-sort-key': [
                      'match',
                      ['get', 'status'],
                      'assigned', 4,
                      'unmatched', 3,
                      'rejected', 2,
                      'invalid_exif', 1,
                      'duplicate', 0,
                      0,
                    ],
                  },
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
          </MapContainer>

            {/* Loading Overlay - appears while data is fetching */}
            {isMapDataLoading && (
              <div className="naxatw-absolute naxatw-inset-0 naxatw-z-20 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-white naxatw-bg-opacity-75 naxatw-rounded">
                <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
                  <div className="naxatw-animate-spin naxatw-text-gray-400">
                    <span className="material-icons">refresh</span>
                  </div>
                  <p className="naxatw-text-sm naxatw-text-gray-600">Loading map data...</p>
                </div>
              </div>
            )}

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
        </div>

        {/* List Section */}
        <div className="naxatw-w-1/2 naxatw-overflow-y-auto naxatw-pr-2">
          <FlexRow className="naxatw-items-center naxatw-justify-between naxatw-mb-3">
            <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
              <p className="naxatw-text-sm naxatw-text-[#484848]">
                Review the classified images grouped by tasks.
              </p>
              <p className="naxatw-text-xs naxatw-text-gray-500">
                Double-click a thumbnail to inspect and override rejections.
              </p>
              <label className="naxatw-flex naxatw-w-fit naxatw-cursor-pointer naxatw-items-center naxatw-gap-2 naxatw-rounded naxatw-border naxatw-border-gray-300 naxatw-px-3 naxatw-py-1.5 naxatw-text-sm naxatw-font-medium naxatw-text-gray-700 naxatw-transition-colors hover:naxatw-border-red hover:naxatw-text-gray-900">
                <span
                  className={`naxatw-flex naxatw-h-4 naxatw-w-4 naxatw-shrink-0 naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-border-2 naxatw-text-white naxatw-transition-colors ${
                    showOnlyIssueImages
                      ? 'naxatw-border-red naxatw-bg-red'
                      : 'naxatw-border-gray-400 naxatw-bg-white'
                  }`}
                >
                  {showOnlyIssueImages && (
                    <svg className="naxatw-h-3 naxatw-w-3" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  className="naxatw-sr-only"
                  checked={showOnlyIssueImages}
                  onChange={(event) => setShowOnlyIssueImages(event.target.checked)}
                />
                Show only images with issues ({totalIssueImages})
              </label>
            </div>
            <FlexRow className="naxatw-gap-3 naxatw-text-xs naxatw-items-start">
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">{showOnlyIssueImages ? visibleTaskCount : reviewData.total_tasks}</span> Tasks
              </span>
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">{filteredLocatedImages.length}</span> on Map
              </span>
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">{totalIssueImages}</span> Issues
              </span>
            </FlexRow>
          </FlexRow>

          {/* Task Accordions */}
          <div className="naxatw-flex naxatw-flex-col">
            {displayedTaskGroups.map((group: TaskGroup, index: number) => (
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
                      {showOnlyIssueImages
                        ? `${group.images.length} ${group.images.length === 1 ? 'issue' : 'issues'}`
                        : `${group.images.length} ${group.images.length === 1 ? 'image' : 'images'}`}
                    </span>
                    {group.is_verified && (
                      <span className="naxatw-rounded-full naxatw-bg-green-100 naxatw-px-3 naxatw-py-1 naxatw-text-sm naxatw-font-medium naxatw-text-green-800">
                        Fully Flown
                      </span>
                    )}
                  </FlexRow>
                }
              >
                {/* Verify Task Button - Only for actual tasks in project-level view (not batch-scoped upload step 3) */}
                {group.task_id && !batchId && (
                  <div className="naxatw-mb-4">
                    <Button
                      variant="ghost"
                      className="naxatw-bg-green-600 naxatw-text-white hover:naxatw-bg-green-700"
                      leftIcon="map"
                      onClick={(e) => {
                        e.stopPropagation();
                        setVerificationModal({
                          isOpen: true,
                          taskId: group.task_id!,
                          taskIndex: group.project_task_index || 0,
                        });
                      }}
                    >
                      Verify Task on Map
                    </Button>
                  </div>
                )}

                {/* Image Grid */}
                <div className="naxatw-grid naxatw-grid-cols-6 naxatw-gap-2">
                  {group.images.map((image) => (
                    <div
                      key={image.id}
                      ref={(el) => { imageRefs.current[image.id] = el; }}
                      className={`naxatw-group naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded naxatw-border-2 naxatw-transition-all hover:naxatw-shadow-md ${
                        highlightedImageId === image.id
                          ? 'naxatw-border-blue-500 naxatw-ring-2 naxatw-ring-blue-300'
                          : image.status === 'rejected' || image.status === 'invalid_exif'
                            ? 'naxatw-border-red-300 hover:naxatw-border-red-500'
                            : image.status === 'duplicate'
                              ? 'naxatw-border-gray-400 hover:naxatw-border-gray-600 naxatw-opacity-60'
                              : 'naxatw-border-gray-200 hover:naxatw-border-blue-500'
                      }`}
                      onClick={() => handleSidebarImageClick(image)}
                      onDoubleClick={() => handleImageClick(image)}
                      title={`${image.filename}${image.rejection_reason ? ` - ${image.rejection_reason}` : ''} (double-click to view)`}
                    >
                      <img
                        src={image.thumbnail_url || image.url}
                        alt={image.filename}
                        className="naxatw-h-full naxatw-w-full naxatw-object-cover"
                        loading="lazy"
                      />
                      {(image.status === 'rejected' || image.status === 'invalid_exif') && (
                        <div className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-red-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white naxatw-truncate">
                          {image.rejection_reason || 'Rejected'}
                        </div>
                      )}
                      {image.status === 'duplicate' && (
                        <div className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-gray-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white">
                          Duplicate
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
                <p className="naxatw-text-xs naxatw-uppercase naxatw-tracking-wider naxatw-text-gray-300 naxatw-mb-1">
                  Status: {selectedImage.status.replace('_', ' ')}
                </p>
                {selectedImage.rejection_reason && (
                  <p className="naxatw-text-sm naxatw-text-red-300">
                    Reason: {selectedImage.rejection_reason}
                  </p>
                )}
                {isDuplicateImage && (
                  <p className="naxatw-text-sm naxatw-text-gray-300">
                    This image is a duplicate of an existing image
                  </p>
                )}
              </div>
              {isRejectedImage && !isDuplicateImage && (
                <Button
                  variant="ghost"
                  className="naxatw-bg-green-600 naxatw-text-white hover:naxatw-bg-green-700"
                  onClick={handleAcceptImage}
                  disabled={acceptMutation.isPending}
                  leftIcon="check"
                >
                  {acceptMutation.isPending ? 'Accepting...' : 'Override rejection'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Task Verification Modal */}
      <TaskVerificationModal
        isOpen={verificationModal.isOpen}
        onClose={() => setVerificationModal({ isOpen: false, taskId: '', taskIndex: 0 })}
        projectId={projectId}
        taskId={verificationModal.taskId}
        taskIndex={verificationModal.taskIndex}
        onVerified={() => {
          if (batchId) {
            queryClient.invalidateQueries({ queryKey: ['batchReview', projectId, batchId] });
          }
          queryClient.invalidateQueries({ queryKey: ['projectReview', projectId] });
          queryClient.invalidateQueries({ queryKey: ['projectMapData', projectId] });
        }}
      />
    </FlexColumn>
  );
};

export default ImageReview;
