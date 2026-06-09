import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Map as MapLibreMap,
  NavigationControl,
  AttributionControl,
  LngLatBoundsLike,
  Popup,
} from "maplibre-gl";
import bbox from "@turf/bbox";
import {
  getProjectReview,
  getProjectMapData,
  getTaskImageUrls,
  getBulkImageUrls,
  getImageUrl,
  acceptImage,
  rejectImage,
  assignImageToTask,
  deleteInvalidImages,
  ProjectReviewData,
  ProjectMapData,
  TaskGroup,
  TaskGroupSummary,
  TaskGroupImage,
  ImageUrls,
} from "@Services/classification";
import { FlexColumn, FlexRow } from "@Components/common/Layouts";
import Accordion from "@Components/common/Accordion";
import { Button } from "@Components/RadixComponents/Button";
import { toast } from "react-toastify";
import MapContainer from "@Components/common/MapLibreComponents/MapContainer";
import VectorLayer from "@Components/common/MapLibreComponents/Layers/VectorLayer";
import BaseLayerSwitcherUI from "@Components/common/BaseLayerSwitcher";
import { GeojsonType } from "@Components/common/MapLibreComponents/types";
import { m } from "@/paraglide/messages";
import TaskVerificationModal from "./TaskVerificationModal";

interface ImageReviewProps {
  projectId: string;
}

const hasIssueStatus = (status?: string) => status !== "assigned";
const canManuallyMatchImage = (status?: string) => status === "unmatched";
const canOverrideImageRejection = (status?: string) =>
  status === "rejected" || status === "invalid_exif";
const canRejectImage = (status?: string) => status === "assigned";

// Run async `worker` over `items` with at most `limit` in-flight at a time.
// Each worker rejection is counted, never thrown - caller gets success/fail tallies.
const BULK_CONCURRENCY = 8;
const runWithConcurrency = async <T,>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<{ successCount: number; failCount: number }> => {
  let successCount = 0;
  let failCount = 0;
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        await worker(items[idx]);
        successCount++;
      } catch {
        failCount++;
      }
    }
  });
  await Promise.all(runners);
  return { successCount, failCount };
};

// Accordion content that lazy-loads presigned thumbnail URLs when opened
const TaskAccordionContent = ({
  group,
  groupKey,
  projectId,
  isOpen,
  highlightedImageId,
  selectedImageIds,
  anchorImageId,
  imageRefs,
  onVerifyTask,
  onCleanup,
  onImageClick,
  onImageDoubleClick,
}: {
  group: TaskGroup;
  groupKey: string;
  projectId: string;
  isOpen: boolean;
  highlightedImageId: string | null;
  selectedImageIds: Set<string>;
  anchorImageId: string | null;
  imageRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onVerifyTask: (taskId: string, taskIndex: number) => void;
  onCleanup: () => void;
  onImageClick: (
    image: TaskGroupImage,
    event: React.MouseEvent,
    groupImages: TaskGroupImage[],
    groupKey: string,
    imageUrls?: Record<string, ImageUrls>,
  ) => void;
  onImageDoubleClick: (image: TaskGroupImage, imageUrls?: Record<string, ImageUrls>) => void;
}) => {
  const COLS = 6;
  const ROW_H = 110;

  // Fetch presigned URLs only when accordion is open
  // For assigned tasks, use the task endpoint; for unassigned, use bulk by image IDs
  const { data: urlsData } = useTaskImageUrls(projectId, group.task_id, isOpen);
  const groupImageIds = useMemo(() => group.images.map((i) => i.id), [group.images]);
  const bulkKey = useMemo(() => [...groupImageIds].sort().join(","), [groupImageIds]);
  const { data: bulkUrlsData } = useQuery({
    queryKey: ["bulkImageUrls", projectId, bulkKey],
    queryFn: () => getBulkImageUrls(projectId, groupImageIds),
    enabled: isOpen && !group.task_id && groupImageIds.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  // Build a lookup map: image_id -> { thumbnail_url, url }
  const urlSource = group.task_id ? urlsData?.images : bulkUrlsData?.images;
  const imageUrlMap = useMemo(() => {
    const map: Record<string, ImageUrls> = {};
    if (urlSource) {
      for (const img of urlSource) {
        map[img.id] = img;
      }
    }
    return map;
  }, [urlSource]);

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const result: TaskGroupImage[][] = [];
    for (let i = 0; i < group.images.length; i += COLS) {
      result.push(group.images.slice(i, i + COLS));
    }
    return result;
  }, [group.images]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 3,
  });

  return (
    <>
      {group.task_id ? (
        <div className="naxatw-mb-4">
          <Button
            variant="ghost"
            className="naxatw-bg-green-600 naxatw-text-white hover:naxatw-bg-green-700"
            leftIcon="map"
            onClick={(e) => {
              e.stopPropagation();
              onVerifyTask(group.task_id!, group.project_task_index || 0);
            }}
          >
            {m.image_review_verify_task_on_map()}
          </Button>
        </div>
      ) : (
        <div className="naxatw-mb-4">
          <Button
            variant="ghost"
            className="naxatw-bg-red naxatw-text-white"
            leftIcon="delete"
            onClick={(e) => {
              e.stopPropagation();
              onCleanup();
            }}
          >
            {m.image_review_cleanup_invalid_imagery()}
          </Button>
        </div>
      )}

      {/* Virtualized Image Grid */}
      <div
        ref={parentRef}
        className="naxatw-overflow-auto naxatw-rounded"
        style={{ maxHeight: `${Math.min(rows.length * ROW_H, 440)}px` }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowImages = rows[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="naxatw-grid naxatw-grid-cols-6 naxatw-gap-2 naxatw-px-0.5"
              >
                {rowImages.map((image) => {
                  const urls = imageUrlMap[image.id];
                  const thumbSrc = urls?.thumbnail_url || urls?.url;
                  const isSelected = selectedImageIds.has(image.id);
                  const isAnchor = anchorImageId === image.id;
                  return (
                    <div
                      key={image.id}
                      ref={(el) => {
                        imageRefs.current[image.id] = el;
                      }}
                      className={`naxatw-group naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded naxatw-border-2 naxatw-transition-all hover:naxatw-shadow-md ${
                        isAnchor
                          ? "naxatw-border-amber-600 naxatw-ring-2 naxatw-ring-amber-400"
                          : isSelected
                            ? "naxatw-border-violet-600 naxatw-ring-2 naxatw-ring-violet-300"
                            : highlightedImageId === image.id
                              ? "naxatw-border-blue-500 naxatw-ring-2 naxatw-ring-blue-300"
                              : image.status === "rejected" || image.status === "invalid_exif"
                                ? "naxatw-border-red-300 hover:naxatw-border-red-500"
                                : image.status === "unmatched"
                                  ? "naxatw-border-yellow-300 hover:naxatw-border-yellow-500"
                                  : image.status === "duplicate"
                                    ? "naxatw-border-gray-400 naxatw-opacity-60 hover:naxatw-border-gray-600"
                                    : "naxatw-border-gray-200 hover:naxatw-border-blue-500"
                      }`}
                      onClick={(e) => onImageClick(image, e, group.images, groupKey, imageUrlMap)}
                      onDoubleClick={() => onImageDoubleClick(image, imageUrlMap)}
                      title={`${image.filename}${image.rejection_reason ? ` - ${image.rejection_reason}` : ""}`}
                    >
                      {thumbSrc ? (
                        <img
                          src={thumbSrc}
                          alt={image.filename}
                          className="naxatw-h-full naxatw-w-full naxatw-object-cover"
                          loading="lazy"
                        />
                      ) : image.status === "duplicate" ? (
                        <div className="naxatw-flex naxatw-h-full naxatw-w-full naxatw-flex-col naxatw-items-center naxatw-justify-center naxatw-bg-gray-100 naxatw-text-gray-400">
                          <span className="material-icons naxatw-text-2xl">content_copy</span>
                          <span className="naxatw-mt-0.5 naxatw-text-[9px]">
                            {m.common_duplicate()}
                          </span>
                        </div>
                      ) : (
                        <div className="naxatw-flex naxatw-h-full naxatw-w-full naxatw-items-center naxatw-justify-center naxatw-bg-gray-100">
                          <div className="naxatw-h-5 naxatw-w-5 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-gray-300 naxatw-border-t-blue-500" />
                        </div>
                      )}
                      {(image.status === "rejected" || image.status === "invalid_exif") && (
                        <div className="naxatw-bg-red-500 naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-truncate naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white">
                          {image.rejection_reason || m.common_rejected()}
                        </div>
                      )}
                      {image.status === "unmatched" && (
                        <div className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-yellow-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white">
                          {m.common_unmatched()}
                        </div>
                      )}
                      {image.status === "duplicate" && (
                        <div className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-gray-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white">
                          {m.common_duplicate()}
                        </div>
                      )}
                      <div className="naxatw-absolute naxatw-inset-0 naxatw-bg-black naxatw-opacity-0 naxatw-transition-opacity group-hover:naxatw-opacity-10" />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

// Hook to fetch presigned URLs for a task on demand
const useTaskImageUrls = (projectId: string, taskId: string | null, enabled: boolean) => {
  return useQuery({
    queryKey: ["taskImageUrls", projectId, taskId],
    queryFn: () => getTaskImageUrls(projectId, taskId!),
    enabled: enabled && !!taskId,
    staleTime: 30 * 60 * 1000, // 30 min (presigned URLs last 1 hour)
  });
};

// Virtualized list of task accordions. Previously every task accordion (header
// + collapsed body) was mounted into the DOM up-front, which for projects with
// hundreds of tasks added significant first-paint cost. The virtualizer keeps
// only visible rows mounted; open state is tracked by the parent via
// `openAccordions`, so a row scrolling out and back in restores correctly.
const VirtualizedAccordionList = ({
  groups,
  openAccordions,
  setOpenAccordions,
  showOnlyIssueImages,
  projectId,
  highlightedImageId,
  selectedImageIds,
  sequenceSelectMode,
  sequenceAnchor,
  imageRefs,
  onVerifyTask,
  onCleanup,
  onImageClick,
  onImageDoubleClick,
}: {
  groups: TaskGroup[];
  openAccordions: Set<string>;
  setOpenAccordions: React.Dispatch<React.SetStateAction<Set<string>>>;
  showOnlyIssueImages: boolean;
  projectId: string;
  highlightedImageId: string | null;
  selectedImageIds: Set<string>;
  sequenceSelectMode: boolean;
  sequenceAnchor: { imageId: string; groupKey: string } | null;
  imageRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onVerifyTask: (taskId: string, taskIndex: number) => void;
  onCleanup: () => void;
  onImageClick: (
    image: TaskGroupImage,
    event: React.MouseEvent,
    groupImages: TaskGroupImage[],
    groupKey: string,
    imageUrls?: Record<string, ImageUrls>,
  ) => void;
  onImageDoubleClick: (image: TaskGroupImage, imageUrls?: Record<string, ImageUrls>) => void;
}) => {
  const parentRef = useRef<HTMLDivElement | null>(null);
  // Approximate collapsed-row height; open rows are measured dynamically.
  const ESTIMATED_ROW_H = 72;
  const virtualizer = useVirtualizer({
    count: groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_H,
    overscan: 4,
    getItemKey: (i) => groups[i].task_id || `unassigned-${i}`,
  });

  return (
    <div ref={parentRef} className="naxatw-h-full naxatw-overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const group = groups[virtualRow.index];
          const accordionKey = group.task_id || `unassigned-${virtualRow.index}`;
          const isAccordionOpen = openAccordions.has(accordionKey);
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <Accordion
                open={isAccordionOpen}
                className="!naxatw-border-b !naxatw-border-gray-300 !naxatw-py-4"
                headerClassName="!naxatw-items-start"
                contentClassName="naxatw-mt-4"
                onToggle={(open: boolean) => {
                  setOpenAccordions((prev) => {
                    const next = new Set(prev);
                    if (open) next.add(accordionKey);
                    else next.delete(accordionKey);
                    return next;
                  });
                }}
                title={
                  <FlexRow className="naxatw-flex-wrap naxatw-items-center naxatw-gap-3">
                    <h4 className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-900">
                      {group.task_id
                        ? m.common_task_number({
                            index: group.project_task_index ?? "",
                          })
                        : m.image_review_unassigned_images()}
                    </h4>
                    <span className="naxatw-rounded-full naxatw-bg-blue-100 naxatw-px-3 naxatw-py-1 naxatw-text-sm naxatw-font-medium naxatw-text-blue-800">
                      {showOnlyIssueImages
                        ? `${group.images.length} ${
                            group.images.length === 1 ? m.common_issue() : m.common_issues_lower()
                          }`
                        : `${group.images.length} ${
                            group.images.length === 1 ? m.common_image() : m.common_images_lower()
                          }`}
                    </span>
                    {group.is_verified && (
                      <span className="naxatw-rounded-full naxatw-bg-green-100 naxatw-px-3 naxatw-py-1 naxatw-text-sm naxatw-font-medium naxatw-text-green-800">
                        {m.common_fully_flown()}
                      </span>
                    )}
                  </FlexRow>
                }
              >
                <TaskAccordionContent
                  group={group}
                  groupKey={accordionKey}
                  projectId={projectId}
                  isOpen={isAccordionOpen}
                  highlightedImageId={highlightedImageId}
                  selectedImageIds={selectedImageIds}
                  anchorImageId={
                    sequenceSelectMode && sequenceAnchor?.groupKey === accordionKey
                      ? sequenceAnchor.imageId
                      : null
                  }
                  imageRefs={imageRefs}
                  onVerifyTask={onVerifyTask}
                  onCleanup={onCleanup}
                  onImageClick={onImageClick}
                  onImageDoubleClick={onImageDoubleClick}
                />
              </Accordion>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ImageReview = ({ projectId }: ImageReviewProps) => {
  const queryClient = useQueryClient();
  const hasFitBoundsRef = useRef(false);
  const popupRef = useRef<Popup | null>(null);
  const [showOnlyIssueImages, setShowOnlyIssueImages] = useState(false);
  const [openAccordions, setOpenAccordions] = useState<Set<string>>(new Set());

  const {
    data: mapData,
    isLoading: isMapDataLoading,
    error: mapDataError,
    isError: isMapDataError,
  } = useQuery<ProjectMapData>({
    queryKey: ["projectMapData", projectId],
    queryFn: () => getProjectMapData(projectId),
    enabled: !!projectId,
  });

  const {
    data: reviewData,
    isLoading: isReviewLoading,
    error: reviewError,
    isError: isReviewError,
  } = useQuery<ProjectReviewData>({
    queryKey: ["projectReview", projectId],
    queryFn: () => getProjectReview(projectId),
    enabled: !!projectId,
  });

  // Build a map of task_id -> images[] from mapData. The mapData payload
  // already carries every image's id/filename/status/rejection_reason plus its
  // task_id, so we reconstruct per-task image arrays client-side instead of
  // re-fetching them via /imagery/review/ - the per-image rows there used to
  // duplicate ~50% of the map-data payload at 30k+ images per project.
  const imagesByTaskId = useMemo(() => {
    const result = new Map<string | null, TaskGroupImage[]>();
    const features = mapData?.images?.features;
    if (!features) return result;
    for (const feature of features) {
      const props: any = feature.properties || {};
      const taskId: string | null = props.task_id ?? null;
      const img: TaskGroupImage = {
        id: props.id,
        filename: props.filename || "Unknown",
        status: props.status,
        rejection_reason: props.rejection_reason,
        uploaded_at: "",
      };
      const existing = result.get(taskId);
      if (existing) existing.push(img);
      else result.set(taskId, [img]);
    }
    for (const arr of result.values()) {
      arr.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
    }
    return result;
  }, [mapData]);

  // Refs that mirror render-time values so map-layer click handlers
  // (bound once in a useEffect) can read the latest data without re-binding.
  const imagesByTaskIdRef = useRef(imagesByTaskId);
  useEffect(() => {
    imagesByTaskIdRef.current = imagesByTaskId;
  }, [imagesByTaskId]);
  const seqClickHandlerRef = useRef<
    (
      image: { id: string; filename: string; status: string },
      groupImages: Array<{ id: string; filename: string; status: string }>,
      groupKey: string,
    ) => boolean
  >(() => false);

  // Gate the spinner on map data only - the sidebar paints in a second pass
  // once the review summary arrives, so users see the map immediately.
  const isLoading = isMapDataLoading;
  const error = isMapDataError ? mapDataError : isReviewError ? reviewError : null;

  // Reset fit bounds when data source changes
  useEffect(() => {
    hasFitBoundsRef.current = false;
  }, [projectId]);

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
    taskId: "",
    taskIndex: 0,
  });
  // Task matching state
  const [taskMatchingImage, setTaskMatchingImage] = useState<{
    id: string;
    filename: string;
  } | null>(null);
  const [confirmMatch, setConfirmMatch] = useState<{
    imageId: string;
    imageFilename: string;
    taskId: string;
    taskIndex: number;
  } | null>(null);
  const taskMatchingImageRef = useRef(taskMatchingImage);
  useEffect(() => {
    taskMatchingImageRef.current = taskMatchingImage;
  }, [taskMatchingImage]);

  // Box-select state
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const boxSelectModeRef = useRef(false);
  useEffect(() => {
    boxSelectModeRef.current = boxSelectMode;
  }, [boxSelectMode]);
  const boxOverlayRef = useRef<HTMLDivElement>(null);
  const [boxSelectedImages, setBoxSelectedImages] = useState<
    Array<{ id: string; filename: string; status: string }>
  >([]);
  const boxSelectedImagesRef = useRef<Array<{ id: string; filename: string; status: string }>>([]);
  useEffect(() => {
    boxSelectedImagesRef.current = boxSelectedImages;
  }, [boxSelectedImages]);
  const selectedImageIds = useMemo(
    () => new Set(boxSelectedImages.map((i) => i.id)),
    [boxSelectedImages],
  );
  // Sequence-select mode: user clicks two thumbnails to select everything
  // in between by filename. The first click sets sequenceAnchor; the second
  // click in the same group commits the range. Esc cancels.
  const [sequenceSelectMode, setSequenceSelectMode] = useState(false);
  const sequenceSelectModeRef = useRef(false);
  useEffect(() => {
    sequenceSelectModeRef.current = sequenceSelectMode;
  }, [sequenceSelectMode]);
  const [sequenceAnchor, setSequenceAnchor] = useState<{
    imageId: string;
    groupKey: string;
  } | null>(null);
  const [bulkTaskMatchingImages, setBulkTaskMatchingImages] = useState<Array<{
    id: string;
    filename: string;
  }> | null>(null);
  const bulkTaskMatchingImagesRef = useRef<Array<{
    id: string;
    filename: string;
  }> | null>(null);
  useEffect(() => {
    bulkTaskMatchingImagesRef.current = bulkTaskMatchingImages;
  }, [bulkTaskMatchingImages]);
  const [confirmBulkMatch, setConfirmBulkMatch] = useState<{
    imageIds: string[];
    taskId: string;
    taskIndex: number;
  } | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

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

    mapInstance.on("load", () => {
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
          console.warn("Error removing map instance:", e);
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
    };
  }, [map, container]);

  // Fit map to task extent when ready
  useEffect(() => {
    if (!map || !isMapLoaded || !mapData?.tasks || hasFitBoundsRef.current) return;
    hasFitBoundsRef.current = true;
    try {
      const [minLng, minLat, maxLng, maxLat] = bbox(mapData.tasks);
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ] as LngLatBoundsLike,
        {
          padding: 40,
          maxZoom: 18,
          duration: 300,
        },
      );
    } catch {
      // ignore invalid geometry
    }
  }, [map, isMapLoaded, mapData]);

  // Add map controls when loaded
  useEffect(() => {
    if (isMapLoaded && map) {
      map.addControl(new NavigationControl(), "top-right");
      map.addControl(
        new AttributionControl({
          compact: true,
        }),
        "bottom-right",
      );
    }
  }, [isMapLoaded, map]);

  // Pointer cursor on image point hover
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = "review-image-points-layer";

    const onMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onMouseLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("mouseenter", layerId, onMouseEnter);
    map.on("mouseleave", layerId, onMouseLeave);

    return () => {
      map.off("mouseenter", layerId, onMouseEnter);
      map.off("mouseleave", layerId, onMouseLeave);
    };
  }, [map, isMapLoaded]);

  const escapeHtml = (str: string): string => {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  };

  const escapeAttr = (str: string): string =>
    str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const buildPopupHtml = (props: {
    id: string;
    filename: string;
    status: string;
    rejection_reason?: string;
  }) => {
    const statusColors: Record<string, string> = {
      assigned: "#22c55e",
      rejected: "#D73F3F",
      unmatched: "#eab308",
      invalid_exif: "#f97316",
      duplicate: "#6b7280",
    };
    const dotColor = statusColors[props.status] || "#3b82f6";
    const showMatchBtn = canManuallyMatchImage(props.status);
    const btnStyle =
      "display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;border:none;margin-top:8px;margin-right:6px;";
    const safeFilename = escapeHtml(props.filename || "Unknown");
    const safeFilenameAttr = escapeAttr(props.filename || "");
    const safeReason = props.rejection_reason ? escapeHtml(props.rejection_reason) : "";
    const safeId = escapeAttr(props.id);
    return `
      <div style="min-width:180px;max-width:280px;font-family:system-ui,sans-serif;">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;word-break:break-all;">${safeFilename}</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#555;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};"></span>
          ${escapeHtml((props.status || "unknown").replace("_", " "))}
        </div>
${safeReason && ["rejected", "unmatched", "invalid_exif", "duplicate"].includes(props.status) ? `<div style="font-size:11px;color:#b91c1c;margin-top:4px;">${safeReason}</div>` : ""}
        <div>
          <button data-inspect-image-id="${safeId}" style="${btnStyle}background:#2563eb;color:white;">
            <span class="material-icons" style="font-size:14px;">visibility</span> Inspect
          </button>
          ${
            showMatchBtn
              ? `<button data-match-image-id="${safeId}" data-match-image-filename="${safeFilenameAttr}" style="${btnStyle}background:#eab308;color:white;">
            <span class="material-icons" style="font-size:14px;">my_location</span> Match to task
          </button>`
              : ""
          }
        </div>
      </div>
    `;
  };

  // Document-level click handlers for popup buttons (raw HTML, not React)
  useEffect(() => {
    const handlePopupClick = async (e: MouseEvent) => {
      const inspectBtn = (e.target as HTMLElement).closest(
        "[data-inspect-image-id]",
      ) as HTMLElement | null;
      if (inspectBtn) {
        const imageId = inspectBtn.getAttribute("data-inspect-image-id");
        if (!imageId || !mapData?.images?.features) return;
        const feature = mapData.images.features.find(
          (f: GeoJSON.Feature<any>) => f.properties?.id === imageId,
        );
        if (feature?.properties) {
          const p = feature.properties;
          // Fetch presigned URL on demand for full image view
          try {
            const urls = await getImageUrl(projectId, imageId);
            setSelectedImage({
              id: p.id,
              url: urls.url || urls.thumbnail_url || "",
              filename: p.filename,
              status: p.status,
              rejection_reason: p.rejection_reason,
            });
          } catch {
            setSelectedImage({
              id: p.id,
              url: "",
              filename: p.filename,
              status: p.status,
              rejection_reason: p.rejection_reason,
            });
          }
        }
        return;
      }

      const matchBtn = (e.target as HTMLElement).closest(
        "[data-match-image-id]",
      ) as HTMLElement | null;
      if (matchBtn) {
        const imageId = matchBtn.getAttribute("data-match-image-id");
        const filename = matchBtn.getAttribute("data-match-image-filename");
        if (imageId && filename) {
          setTaskMatchingImage({ id: imageId, filename });
          if (popupRef.current) {
            popupRef.current.remove();
            popupRef.current = null;
          }
        }
      }
    };

    document.addEventListener("click", handlePopupClick);
    return () => document.removeEventListener("click", handlePopupClick);
  }, [mapData, projectId]);

  // Custom popup on map click (replaces AsyncPopup for reliable close behavior)
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = "review-image-points-layer";

    const handleClick = (e: any) => {
      if (boxSelectModeRef.current) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: [layerId],
      });
      if (!features?.length) return;

      const props = features[0].properties;
      const coords = (features[0].geometry as any).coordinates.slice();

      // Sequence-select intercepts the map click: build a same-task range
      // by filename and add to the bulk selection. Suppress the popup so
      // the user can chain clicks without manually dismissing it.
      if (sequenceSelectModeRef.current) {
        const taskId: string | null = props.task_id ?? null;
        const groupKey = taskId ?? `unassigned-map`;
        const groupImages = imagesByTaskIdRef.current.get(taskId) || [];
        seqClickHandlerRef.current(
          {
            id: props.id,
            filename: props.filename,
            status: props.status,
          },
          groupImages,
          groupKey,
        );
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
        setHighlightedImageId(props.id);
        return;
      }

      // Close existing popup
      if (popupRef.current) {
        popupRef.current.remove();
      }

      const html = buildPopupHtml(props as any);

      const newPopup = new Popup({
        closeButton: true,
        closeOnClick: false,
        offset: 12,
        anchor: "bottom",
        maxWidth: "300px",
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
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 100);
    };

    map.on("click", layerId, handleClick);

    return () => {
      map.off("click", layerId, handleClick);
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
    };
  }, [map, isMapLoaded]);

  // Update map highlight when highlightedImageId or boxSelectedImages changes
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = "review-image-points-layer";

    try {
      if (!map.getLayer(layerId)) return;

      if (boxSelectedImages.length > 0) {
        const ids = boxSelectedImages.map((i) => i.id);
        map.setPaintProperty(layerId, "circle-stroke-width", [
          "case",
          ["in", ["get", "id"], ["literal", ids]],
          4,
          2,
        ]);
        map.setPaintProperty(layerId, "circle-stroke-color", [
          "case",
          ["in", ["get", "id"], ["literal", ids]],
          "#7c3aed",
          "#ffffff",
        ]);
        map.setPaintProperty(layerId, "circle-radius", [
          "case",
          ["in", ["get", "id"], ["literal", ids]],
          8,
          5,
        ]);
      } else if (highlightedImageId) {
        map.setPaintProperty(layerId, "circle-stroke-width", [
          "case",
          ["==", ["get", "id"], highlightedImageId],
          4,
          2,
        ]);
        map.setPaintProperty(layerId, "circle-stroke-color", [
          "case",
          ["==", ["get", "id"], highlightedImageId],
          "#2563eb",
          "#ffffff",
        ]);
        map.setPaintProperty(layerId, "circle-radius", [
          "case",
          ["==", ["get", "id"], highlightedImageId],
          8,
          5,
        ]);
      } else {
        map.setPaintProperty(layerId, "circle-stroke-width", 2);
        map.setPaintProperty(layerId, "circle-stroke-color", "#ffffff");
        map.setPaintProperty(layerId, "circle-radius", 5);
      }
    } catch {
      // Layer might not exist yet
    }
  }, [map, isMapLoaded, highlightedImageId, boxSelectedImages]);

  // Task picker mode: highlight tasks on hover and handle click to select
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const fillLayerId = "review-task-polygons-layer";
    const isPickerActive = () =>
      !!taskMatchingImageRef.current || !!bulkTaskMatchingImagesRef.current;

    const onMouseMove = (e: any) => {
      if (!isPickerActive()) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: [fillLayerId],
      });
      map.getCanvas().style.cursor = features?.length ? "pointer" : "crosshair";
      try {
        if (features?.length) {
          const hoveredId = features[0].properties?.id;
          map.setPaintProperty(fillLayerId, "fill-opacity", [
            "case",
            ["==", ["get", "id"], hoveredId],
            0.7,
            0.4,
          ]);
        } else {
          map.setPaintProperty(fillLayerId, "fill-opacity", 0.4);
        }
      } catch {
        /* layer may not exist */
      }
    };

    const onMouseLeave = () => {
      if (!isPickerActive()) return;
      try {
        map.setPaintProperty(fillLayerId, "fill-opacity", 0.4);
      } catch {
        /* */
      }
    };

    const onClick = (e: any) => {
      if (!isPickerActive()) return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: [fillLayerId],
      });
      if (!features?.length) return;
      const taskProps = features[0].properties;
      const singleMatching = taskMatchingImageRef.current;
      const bulkMatching = bulkTaskMatchingImagesRef.current;
      if (singleMatching && taskProps) {
        setConfirmMatch({
          imageId: singleMatching.id,
          imageFilename: singleMatching.filename,
          taskId: taskProps.id,
          taskIndex: taskProps.task_index,
        });
      } else if (bulkMatching && taskProps) {
        setConfirmBulkMatch({
          imageIds: bulkMatching.map((i) => i.id),
          taskId: taskProps.id,
          taskIndex: taskProps.task_index,
        });
      }
    };

    map.on("mousemove", fillLayerId, onMouseMove);
    map.on("mouseleave", fillLayerId, onMouseLeave);
    map.on("click", fillLayerId, onClick);

    return () => {
      map.off("mousemove", fillLayerId, onMouseMove);
      map.off("mouseleave", fillLayerId, onMouseLeave);
      map.off("click", fillLayerId, onClick);
    };
  }, [map, isMapLoaded]);

  // Update cursor when entering/leaving picker or box-select mode
  useEffect(() => {
    if (!map) return;
    if (taskMatchingImage || bulkTaskMatchingImages) {
      map.getCanvas().style.cursor = "crosshair";
    } else if (!boxSelectMode) {
      map.getCanvas().style.cursor = "";
    }
  }, [map, taskMatchingImage, bulkTaskMatchingImages, boxSelectMode]);

  // Box-select: disable drag-pan, capture rubber-band rect, query features on mouseup
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    if (!boxSelectMode) {
      map.dragPan.enable();
      return;
    }

    map.dragPan.disable();
    const canvas = map.getCanvas();

    let dragStart: { x: number; y: number } | null = null;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (boxOverlayRef.current) {
        boxOverlayRef.current.style.left = `${dragStart.x}px`;
        boxOverlayRef.current.style.top = `${dragStart.y}px`;
        boxOverlayRef.current.style.width = "0px";
        boxOverlayRef.current.style.height = "0px";
        boxOverlayRef.current.style.display = "block";
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragStart) return;
      const rect = canvas.getBoundingClientRect();
      const curX = Math.max(0, Math.min(e.clientX - rect.left, canvas.offsetWidth));
      const curY = Math.max(0, Math.min(e.clientY - rect.top, canvas.offsetHeight));
      if (boxOverlayRef.current) {
        boxOverlayRef.current.style.left = `${Math.min(dragStart.x, curX)}px`;
        boxOverlayRef.current.style.top = `${Math.min(dragStart.y, curY)}px`;
        boxOverlayRef.current.style.width = `${Math.abs(curX - dragStart.x)}px`;
        boxOverlayRef.current.style.height = `${Math.abs(curY - dragStart.y)}px`;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!dragStart) return;
      const rect = canvas.getBoundingClientRect();
      const endX = Math.max(0, Math.min(e.clientX - rect.left, canvas.offsetWidth));
      const endY = Math.max(0, Math.min(e.clientY - rect.top, canvas.offsetHeight));

      if (boxOverlayRef.current) {
        boxOverlayRef.current.style.display = "none";
      }

      if (Math.abs(endX - dragStart.x) > 5 || Math.abs(endY - dragStart.y) > 5) {
        const sw: [number, number] = [Math.min(dragStart.x, endX), Math.min(dragStart.y, endY)];
        const ne: [number, number] = [Math.max(dragStart.x, endX), Math.max(dragStart.y, endY)];
        const features = map.queryRenderedFeatures([sw, ne], {
          layers: ["review-image-points-layer"],
        });

        const seen = new Set<string>();
        const selected = features
          .map((f) => ({
            id: f.properties?.id as string,
            filename: f.properties?.filename as string,
            status: f.properties?.status as string,
          }))
          .filter((i) => {
            if (!i.id || seen.has(i.id)) return false;
            seen.add(i.id);
            return true;
          });

        setBoxSelectedImages(selected);
      }

      dragStart = null;
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      map.dragPan.enable();
      if (boxOverlayRef.current) {
        boxOverlayRef.current.style.display = "none";
      }
    };
  }, [map, isMapLoaded, boxSelectMode]);

  // Escape: cancel bulk picker → clear selection → exit selection modes
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (bulkTaskMatchingImagesRef.current) {
        setBulkTaskMatchingImages(null);
      } else if (boxSelectedImagesRef.current.length > 0) {
        setBoxSelectedImages([]);
        setSequenceAnchor(null);
      } else if (sequenceSelectModeRef.current) {
        setSequenceSelectMode(false);
        setSequenceAnchor(null);
      } else if (boxSelectModeRef.current) {
        setBoxSelectMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const acceptMutation = useMutation({
    mutationFn: (imageId: string) => acceptImage(projectId, imageId),
    onSuccess: (data) => {
      if (data.status === "unmatched") {
        toast.warning(data.message);
      } else {
        toast.success(m.image_review_image_accepted_success());
      }
      queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["projectMapData", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["project-task-states", projectId],
      });
      setSelectedImage(null);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.detail || error.message || m.image_review_failed_accept_image();
      toast.error(message);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (imageId: string) => rejectImage(projectId, imageId),
    onSuccess: () => {
      toast.success(m.image_review_image_rejected_success());
      queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["projectMapData", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["project-task-states", projectId],
      });
      setSelectedImage(null);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.detail || error.message || m.image_review_failed_reject_image();
      toast.error(message);
    },
  });

  const assignTaskMutation = useMutation({
    mutationFn: ({ imageId, taskId }: { imageId: string; taskId: string }) =>
      assignImageToTask(projectId, imageId, taskId),
    onSuccess: () => {
      toast.success(m.image_review_image_assigned_success());
      queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["projectMapData", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["project-task-states", projectId],
      });
      setConfirmMatch(null);
      setTaskMatchingImage(null);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.detail || error.message || m.image_review_failed_assign_image();
      toast.error(message);
    },
  });

  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);

  const cleanupInvalidMutation = useMutation({
    mutationFn: () => deleteInvalidImages(projectId),
    onSuccess: (data) => {
      if (data.failed_count) {
        toast.error(data.message);
      } else {
        toast.success(
          m.image_review_deleted_invalid_images({
            count: data.deleted_count,
            suffix: data.deleted_count === 1 ? "" : "s",
          }),
        );
      }
      queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
      queryClient.invalidateQueries({
        queryKey: ["projectMapData", projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ["project-task-states", projectId],
      });
      setShowCleanupConfirm(false);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.detail ||
        error.message ||
        m.image_review_failed_delete_invalid_images();
      toast.error(message);
      setShowCleanupConfirm(false);
    },
  });

  const handleImageClick = async (image: TaskGroupImage, imageUrls?: Record<string, ImageUrls>) => {
    const urls = imageUrls?.[image.id];
    // Show thumbnail immediately while we fetch full-resolution
    const thumbUrl = urls?.thumbnail_url || "";
    setSelectedImage({
      id: image.id,
      url: urls?.url || thumbUrl,
      filename: image.filename,
      status: image.status,
      rejection_reason: image.rejection_reason,
    });
    // If we don't have a full-resolution URL, fetch it on demand
    if (!urls?.url) {
      try {
        const fetched = await getImageUrl(projectId, image.id);
        setSelectedImage((prev) =>
          prev?.id === image.id
            ? { ...prev, url: fetched.url || fetched.thumbnail_url || "" }
            : prev,
        );
      } catch {
        /* ignore */
      }
    }
  };

  // Shared sequence-select handler - used by sidebar thumbnail clicks AND
  // map-point clicks. First click in a group sets the anchor and adds the
  // image to the selection. A second click in the same group commits the
  // filename-sorted range between them and resets the anchor to the
  // just-clicked image (so chained sequences work without leaving the mode).
  // Returns true if it consumed the click.
  const handleSequenceSelectClick = (
    image: { id: string; filename: string; status: string },
    groupImages: Array<{ id: string; filename: string; status: string }>,
    groupKey: string,
  ): boolean => {
    if (!sequenceSelectMode) return false;
    const sameGroupAnchor =
      sequenceAnchor && sequenceAnchor.groupKey === groupKey ? sequenceAnchor : null;
    const sorted = [...groupImages].sort((a, b) =>
      a.filename.localeCompare(b.filename, undefined, { numeric: true }),
    );
    const anchorIdx = sameGroupAnchor
      ? sorted.findIndex((i) => i.id === sameGroupAnchor.imageId)
      : -1;
    const clickIdx = sorted.findIndex((i) => i.id === image.id);

    if (anchorIdx !== -1 && clickIdx !== -1 && anchorIdx !== clickIdx) {
      const [lo, hi] = anchorIdx <= clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];
      const range = sorted.slice(lo, hi + 1).map((i) => ({
        id: i.id,
        filename: i.filename,
        status: i.status,
      }));
      setBoxSelectedImages((prev) => {
        const merged = new Map(prev.map((p) => [p.id, p]));
        for (const item of range) merged.set(item.id, item);
        return Array.from(merged.values());
      });
      setSequenceAnchor({ imageId: image.id, groupKey });
      return true;
    }

    if (clickIdx !== -1) {
      setSequenceAnchor({ imageId: image.id, groupKey });
      setBoxSelectedImages((prev) =>
        prev.some((p) => p.id === image.id)
          ? prev
          : [...prev, { id: image.id, filename: image.filename, status: image.status }],
      );
    }
    return true;
  };
  // Keep the map click handler (bound once in a useEffect) pointing at the
  // latest handler closure on every render.
  seqClickHandlerRef.current = handleSequenceSelectClick;

  // Handle sidebar thumbnail click:
  //   - Sequence-select mode consumes the click via handleSequenceSelectClick.
  //   - Ctrl/Cmd+click toggles a single image in/out of the bulk selection.
  //   - Plain click highlights the image and flies to it on the map.
  const handleSidebarImageClick = (
    image: TaskGroupImage,
    event: React.MouseEvent,
    groupImages: TaskGroupImage[],
    groupKey: string,
    _imageUrls?: Record<string, ImageUrls>,
  ) => {
    if (handleSequenceSelectClick(image, groupImages, groupKey)) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      setBoxSelectedImages((prev) => {
        if (prev.some((p) => p.id === image.id)) {
          return prev.filter((p) => p.id !== image.id);
        }
        return [...prev, { id: image.id, filename: image.filename, status: image.status }];
      });
      return;
    }

    setHighlightedImageId(image.id);

    // Find the image's coordinates on the map and fly to it
    if (map && mapData?.images?.features) {
      const feature = mapData.images.features.find(
        (f: GeoJSON.Feature<any>) => f.properties?.id === image.id && f.geometry,
      );
      if (feature && feature.geometry && "coordinates" in feature.geometry) {
        const coords = (feature.geometry as GeoJSON.Point).coordinates;

        // Close existing popup
        if (popupRef.current) {
          popupRef.current.remove();
        }

        const html = buildPopupHtml({
          id: image.id,
          filename: image.filename,
          status: image.status,
          rejection_reason: image.rejection_reason,
        });

        const newPopup = new Popup({
          closeButton: true,
          closeOnClick: false,
          offset: 12,
          anchor: "bottom",
          maxWidth: "300px",
        })
          .setLngLat(coords as [number, number])
          .setHTML(html)
          .addTo(map);

        popupRef.current = newPopup;

        map.flyTo({
          center: coords as [number, number],
          zoom: Math.max(map.getZoom(), 16),
          duration: 500,
        });
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

  const handleRejectImage = () => {
    if (selectedImage) {
      rejectMutation.mutate(selectedImage.id);
    }
  };

  const handleBulkOverrideRejection = async () => {
    const toOverride = boxSelectedImages.filter((i) => canOverrideImageRejection(i.status));
    if (!toOverride.length) return;
    setIsBulkProcessing(true);
    const { successCount, failCount } = await runWithConcurrency(
      toOverride,
      BULK_CONCURRENCY,
      (img) => acceptImage(projectId, img.id).then(() => undefined),
    );
    setIsBulkProcessing(false);
    if (failCount > 0) {
      toast.error(`Accepted ${successCount}, failed to accept ${failCount} images.`);
    } else {
      toast.success(`${successCount} image${successCount > 1 ? "s" : ""} accepted`);
    }
    queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
    queryClient.invalidateQueries({ queryKey: ["projectMapData", projectId] });
    queryClient.invalidateQueries({
      queryKey: ["project-task-states", projectId],
    });
    setBoxSelectedImages([]);
  };

  const handleBulkRejectImages = async () => {
    const toReject = boxSelectedImages.filter((i) => canRejectImage(i.status));
    if (!toReject.length) return;
    setIsBulkProcessing(true);
    const { successCount, failCount } = await runWithConcurrency(
      toReject,
      BULK_CONCURRENCY,
      (img) => rejectImage(projectId, img.id).then(() => undefined),
    );
    setIsBulkProcessing(false);
    if (failCount > 0) {
      toast.error(`Rejected ${successCount}, failed to reject ${failCount} images.`);
    } else {
      toast.success(`${successCount} image${successCount > 1 ? "s" : ""} rejected`);
    }
    queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
    queryClient.invalidateQueries({ queryKey: ["projectMapData", projectId] });
    queryClient.invalidateQueries({
      queryKey: ["project-task-states", projectId],
    });
    setBoxSelectedImages([]);
  };

  const handleBulkAssignConfirm = async () => {
    if (!confirmBulkMatch) return;
    const { imageIds, taskId, taskIndex } = confirmBulkMatch;
    setIsBulkProcessing(true);
    const { successCount, failCount } = await runWithConcurrency(
      imageIds,
      BULK_CONCURRENCY,
      (imageId) => assignImageToTask(projectId, imageId, taskId).then(() => undefined),
    );
    setIsBulkProcessing(false);
    if (failCount > 0) {
      toast.error(`Assigned ${successCount}, failed to assign ${failCount} images.`);
    } else {
      toast.success(
        `${successCount} image${successCount > 1 ? "s" : ""} assigned to Task #${taskIndex}`,
      );
    }
    queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
    queryClient.invalidateQueries({ queryKey: ["projectMapData", projectId] });
    queryClient.invalidateQueries({
      queryKey: ["project-task-states", projectId],
    });
    setConfirmBulkMatch(null);
    setBulkTaskMatchingImages(null);
    setBoxSelectedImages([]);
  };

  // ─── Memoized derivations ────────────────────────────────────────────────
  // Hoisted above any early returns so hook order stays stable. Each was
  // previously recomputed on every render (selections, hover, etc.) which is
  // expensive at 30k+ images.

  const locatedImages = useMemo(
    () =>
      mapData?.images?.features?.filter(
        (feature: GeoJSON.Feature<any>) => feature.geometry !== null,
      ) || [],
    [mapData],
  );

  const filteredLocatedImages = useMemo(
    () =>
      showOnlyIssueImages
        ? locatedImages.filter((feature: GeoJSON.Feature<any>) =>
            hasIssueStatus(feature.properties?.status),
          )
        : locatedImages,
    [locatedImages, showOnlyIssueImages],
  );

  const locatedImagesGeojson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: filteredLocatedImages as GeoJSON.Feature<any>[],
    }),
    [filteredLocatedImages],
  );

  // Join the summary (review data) with the per-task image arrays we built
  // from mapData. The summary is authoritative for ordering & is_verified;
  // images come from mapData (which is loaded first and already contains
  // every image's id/filename/status/rejection_reason regardless of GPS).
  const displayedTaskGroups = useMemo<TaskGroup[]>(() => {
    if (!reviewData) return [];
    return reviewData.task_groups
      .map((summary: TaskGroupSummary) => {
        const images = imagesByTaskId.get(summary.task_id) || [];
        const filteredImages = showOnlyIssueImages
          ? images.filter((image) => hasIssueStatus(image.status))
          : images;
        return { ...summary, images: filteredImages };
      })
      .filter((group) => !showOnlyIssueImages || group.images.length > 0);
  }, [reviewData, imagesByTaskId, showOnlyIssueImages]);

  const totalIssueImages = useMemo(() => {
    if (!reviewData) return 0;
    return reviewData.task_groups.reduce((count: number, group: TaskGroupSummary) => {
      const c = group.status_counts;
      return count + c.rejected + c.invalid_exif + c.duplicate + c.unmatched;
    }, 0);
  }, [reviewData]);

  const visibleTaskCount = useMemo(
    () => displayedTaskGroups.filter((g) => g.task_id).length,
    [displayedTaskGroups],
  );

  if (isLoading) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-gray-500">{m.image_review_loading_review_data()}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-red-500">
          {m.image_review_error_loading_review_data({
            message: error instanceof Error ? error.message : m.common_unknown_error(),
          })}
        </p>
      </div>
    );
  }

  // Empty state only once both queries have resolved with zero classified images.
  if (reviewData && reviewData.task_groups.length === 0) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-gray-500">{m.image_review_no_classified_images()}</p>
      </div>
    );
  }

  const isRejectedImage = selectedImage && canOverrideImageRejection(selectedImage.status);
  const isAssignedImage = selectedImage && selectedImage.status === "assigned";
  const isUnmatchedImage = selectedImage && selectedImage.status === "unmatched";
  const isDuplicateImage = selectedImage && selectedImage.status === "duplicate";
  const canOverride = isRejectedImage && !isDuplicateImage;
  const canReject = isAssignedImage;
  const canMatch = isUnmatchedImage;

  return (
    <FlexColumn className="naxatw-h-full naxatw-gap-4">
      {/* Map and List Split View */}
      <div className="naxatw-flex naxatw-min-h-0 naxatw-flex-1 naxatw-gap-4 naxatw-overflow-hidden">
        {/* Map Section */}
        <div className="naxatw-relative naxatw-flex naxatw-w-1/2 naxatw-flex-col naxatw-overflow-hidden naxatw-rounded naxatw-border naxatw-border-gray-300">
          {/* Map toolbar */}
          <div className="naxatw-flex naxatw-shrink-0 naxatw-items-center naxatw-gap-3 naxatw-border-b naxatw-border-gray-200 naxatw-bg-white naxatw-px-3 naxatw-py-1.5">
            <button
              onClick={() => {
                if (boxSelectMode) setBoxSelectedImages([]);
                const next = !boxSelectMode;
                setBoxSelectMode(next);
                if (next && sequenceSelectMode) {
                  setSequenceSelectMode(false);
                  setSequenceAnchor(null);
                }
              }}
              title={
                boxSelectMode ? m.common_cancel_escape() : m.image_review_select_multiple_help()
              }
              className={`naxatw-flex naxatw-items-center naxatw-gap-1.5 naxatw-rounded naxatw-border naxatw-px-2.5 naxatw-py-1 naxatw-text-xs naxatw-font-medium naxatw-transition-colors ${
                boxSelectMode
                  ? "naxatw-border-violet-600 naxatw-bg-violet-600 naxatw-text-white"
                  : "naxatw-border-gray-300 naxatw-bg-white naxatw-text-gray-700 hover:naxatw-border-violet-400 hover:naxatw-text-violet-600"
              }`}
            >
              <span className="material-icons" style={{ fontSize: "14px" }}>
                select_all
              </span>
              {m.image_review_select_multiple()}
            </button>
            <button
              onClick={() => {
                const next = !sequenceSelectMode;
                setSequenceSelectMode(next);
                setSequenceAnchor(null);
                if (next && boxSelectMode) {
                  setBoxSelectMode(false);
                }
              }}
              title={
                sequenceSelectMode
                  ? m.common_cancel_escape()
                  : m.image_review_select_sequence_help()
              }
              className={`naxatw-flex naxatw-items-center naxatw-gap-1.5 naxatw-rounded naxatw-border naxatw-px-2.5 naxatw-py-1 naxatw-text-xs naxatw-font-medium naxatw-transition-colors ${
                sequenceSelectMode
                  ? "naxatw-border-amber-600 naxatw-bg-amber-600 naxatw-text-white"
                  : "naxatw-border-gray-300 naxatw-bg-white naxatw-text-gray-700 hover:naxatw-border-amber-500 hover:naxatw-text-amber-700"
              }`}
            >
              <span className="material-icons" style={{ fontSize: "14px" }}>
                linear_scale
              </span>
              {m.image_review_select_sequence()}
            </button>
            {boxSelectMode && (
              <span className="naxatw-text-xs naxatw-text-gray-500">
                {m.image_review_select_multiple_help()}
              </span>
            )}
            {sequenceSelectMode && (
              <span className="naxatw-text-xs naxatw-text-gray-500">
                {m.image_review_select_sequence_help()}
              </span>
            )}
          </div>

          {/* Map Container */}
          <div
            className="naxatw-relative naxatw-flex-1"
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: "400px",
            }}
          >
            <MapContainer
              ref={mapContainerRefCallback}
              map={map}
              isMapLoaded={isMapLoaded}
              containerId="image-review-map"
              style={{
                width: "100%",
                height: "100%",
                flex: 1,
              }}
            >
              <BaseLayerSwitcherUI />

              {/* Task polygons */}
              {map && isMapLoaded && mapData?.tasks && (
                <VectorLayer
                  key={`task-polygons-${mapData?.total_images_with_gps || "pending"}`}
                  map={map}
                  isMapLoaded={isMapLoaded}
                  id="review-task-polygons"
                  geojson={mapData.tasks as GeojsonType}
                  visibleOnMap={true}
                  layerOptions={{
                    type: "fill",
                    paint: {
                      "fill-color": "#98BBC8",
                      "fill-outline-color": "#484848",
                      "fill-opacity": 0.4,
                    },
                  }}
                />
              )}

              {/* Task polygon outlines for better visibility */}
              {map && isMapLoaded && mapData?.tasks && (
                <VectorLayer
                  key={`task-outlines-${mapData?.total_images_with_gps || "pending"}`}
                  map={map}
                  isMapLoaded={isMapLoaded}
                  id="review-task-outlines"
                  geojson={mapData.tasks as GeojsonType}
                  visibleOnMap={true}
                  layerOptions={{
                    type: "line",
                    paint: {
                      "line-color": "#484848",
                      "line-width": 2,
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
                    type: "circle",
                    layout: {
                      "circle-sort-key": [
                        "match",
                        ["get", "status"],
                        "assigned",
                        4,
                        "unmatched",
                        3,
                        "rejected",
                        2,
                        "invalid_exif",
                        1,
                        "duplicate",
                        0,
                        0,
                      ],
                    },
                    paint: {
                      "circle-color": [
                        "match",
                        ["get", "status"],
                        "assigned",
                        "#22c55e",
                        "rejected",
                        "#D73F3F",
                        "unmatched",
                        "#eab308",
                        "invalid_exif",
                        "#f97316",
                        "duplicate",
                        "#6b7280",
                        "#3b82f6",
                      ],
                      "circle-radius": 5,
                      "circle-stroke-width": 2,
                      "circle-stroke-color": "#ffffff",
                      "circle-stroke-opacity": 0.8,
                    },
                  }}
                />
              )}
            </MapContainer>

            {/* Loading Overlay - appears while data is fetching */}
            {isMapDataLoading && (
              <div className="naxatw-absolute naxatw-inset-0 naxatw-z-20 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-bg-white naxatw-bg-opacity-75">
                <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
                  <div className="naxatw-animate-spin naxatw-text-gray-400">
                    <span className="material-icons">refresh</span>
                  </div>
                  <p className="naxatw-text-sm naxatw-text-gray-600">
                    {m.image_review_loading_map_data()}
                  </p>
                </div>
              </div>
            )}

            {/* Rubber-band selection rectangle - updated via ref to avoid re-renders */}
            <div
              ref={boxOverlayRef}
              style={{
                position: "absolute",
                pointerEvents: "none",
                zIndex: 15,
                border: "2px dashed #7c3aed",
                backgroundColor: "rgba(124, 58, 237, 0.1)",
                display: "none",
              }}
            />

            {/* Bulk action bar */}
            {boxSelectedImages.length > 0 && !bulkTaskMatchingImages && !taskMatchingImage && (
              <div className="naxatw-absolute naxatw-left-2 naxatw-right-2 naxatw-top-2 naxatw-z-20 naxatw-rounded naxatw-bg-violet-600 naxatw-px-3 naxatw-py-2 naxatw-shadow-lg">
                <div className="naxatw-mb-2 naxatw-flex naxatw-items-center naxatw-justify-between">
                  <span className="naxatw-text-sm naxatw-font-medium naxatw-text-white">
                    {m.image_review_selected_images({
                      count: boxSelectedImages.length,
                      label:
                        boxSelectedImages.length > 1 ? m.common_images_lower() : m.common_image(),
                    })}
                  </span>
                  <button
                    onClick={() => {
                      setBoxSelectedImages([]);
                      setSequenceAnchor(null);
                    }}
                    className="naxatw-rounded naxatw-bg-white naxatw-bg-opacity-20 naxatw-px-2 naxatw-py-0.5 naxatw-text-xs naxatw-font-semibold naxatw-text-white hover:naxatw-bg-opacity-30"
                  >
                    {m.common_clear_escape()}
                  </button>
                </div>
                <div className="naxatw-flex naxatw-flex-wrap naxatw-gap-2">
                  {(() => {
                    const overridable = boxSelectedImages.filter((i) =>
                      canOverrideImageRejection(i.status),
                    );
                    const matchable = boxSelectedImages.filter((i) =>
                      canManuallyMatchImage(i.status),
                    );
                    const rejectable = boxSelectedImages.filter((i) => canRejectImage(i.status));
                    return (
                      <>
                        {overridable.length > 0 && (
                          <button
                            onClick={handleBulkOverrideRejection}
                            disabled={isBulkProcessing}
                            className="naxatw-flex naxatw-items-center naxatw-gap-1 naxatw-rounded naxatw-bg-green-600 naxatw-px-3 naxatw-py-1 naxatw-text-xs naxatw-font-semibold naxatw-text-white hover:naxatw-bg-green-700 disabled:naxatw-opacity-50"
                          >
                            <span className="material-icons" style={{ fontSize: "12px" }}>
                              check
                            </span>
                            {m.image_review_override_rejection_count({
                              count: overridable.length,
                            })}
                          </button>
                        )}
                        {rejectable.length > 0 && (
                          <button
                            onClick={handleBulkRejectImages}
                            disabled={isBulkProcessing}
                            className="naxatw-flex naxatw-items-center naxatw-gap-1 naxatw-rounded naxatw-bg-red naxatw-px-3 naxatw-py-1 naxatw-text-xs naxatw-font-semibold naxatw-text-white hover:naxatw-bg-red-600 disabled:naxatw-opacity-50"
                          >
                            <span className="material-icons" style={{ fontSize: "12px" }}>
                              block
                            </span>
                            {m.image_review_reject_count({
                              count: rejectable.length,
                            })}
                          </button>
                        )}
                        {matchable.length > 0 && (
                          <button
                            onClick={() => {
                              setBoxSelectMode(false);
                              setBulkTaskMatchingImages(matchable);
                            }}
                            disabled={isBulkProcessing}
                            className="naxatw-flex naxatw-items-center naxatw-gap-1 naxatw-rounded naxatw-bg-yellow-500 naxatw-px-3 naxatw-py-1 naxatw-text-xs naxatw-font-semibold naxatw-text-white hover:naxatw-bg-yellow-600 disabled:naxatw-opacity-50"
                          >
                            <span className="material-icons" style={{ fontSize: "12px" }}>
                              my_location
                            </span>
                            {m.image_review_assign_to_task_count({
                              count: matchable.length,
                            })}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Bulk task picker mode banner */}
            {bulkTaskMatchingImages && (
              <div className="naxatw-absolute naxatw-left-2 naxatw-right-2 naxatw-top-2 naxatw-z-20 naxatw-flex naxatw-items-center naxatw-justify-between naxatw-rounded naxatw-bg-yellow-500 naxatw-px-4 naxatw-py-2 naxatw-shadow-lg">
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-sm naxatw-font-medium naxatw-text-white">
                  <span className="material-icons naxatw-text-base">my_location</span>
                  {m.image_review_click_task_area_assign()}{" "}
                  <span className="naxatw-font-bold">{bulkTaskMatchingImages.length} images</span>
                </div>
                <button
                  onClick={() => setBulkTaskMatchingImages(null)}
                  className="naxatw-rounded naxatw-bg-white naxatw-bg-opacity-20 naxatw-px-3 naxatw-py-1 naxatw-text-xs naxatw-font-semibold naxatw-text-white hover:naxatw-bg-opacity-30"
                >
                  {m.common_cancel_escape()}
                </button>
              </div>
            )}

            {/* Task picker mode banner */}
            {taskMatchingImage && (
              <div className="naxatw-absolute naxatw-left-2 naxatw-right-2 naxatw-top-2 naxatw-z-20 naxatw-flex naxatw-items-center naxatw-justify-between naxatw-rounded naxatw-bg-yellow-500 naxatw-px-4 naxatw-py-2 naxatw-shadow-lg">
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-sm naxatw-font-medium naxatw-text-white">
                  <span className="material-icons naxatw-text-base">my_location</span>
                  {m.image_review_click_task_area_assign()}{" "}
                  <span className="naxatw-font-bold">{taskMatchingImage.filename}</span>
                </div>
                <button
                  onClick={() => setTaskMatchingImage(null)}
                  className="naxatw-rounded naxatw-bg-white naxatw-bg-opacity-20 naxatw-px-3 naxatw-py-1 naxatw-text-xs naxatw-font-semibold naxatw-text-white hover:naxatw-bg-opacity-30"
                >
                  {m.common_cancel()}
                </button>
              </div>
            )}

            {/* Legend */}
            <div className="naxatw-absolute naxatw-bottom-8 naxatw-left-2 naxatw-z-10 naxatw-rounded naxatw-bg-white naxatw-p-2 naxatw-shadow-md">
              <p className="naxatw-mb-1 naxatw-text-xs naxatw-font-semibold">
                {m.common_image_status()}
              </p>
              <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                  <div
                    className="naxatw-h-3 naxatw-w-3 naxatw-rounded-full"
                    style={{ backgroundColor: "#22c55e" }}
                  />
                  <span className="naxatw-text-xs">{m.common_assigned()}</span>
                </div>
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                  <div
                    className="naxatw-h-3 naxatw-w-3 naxatw-rounded-full"
                    style={{ backgroundColor: "#D73F3F" }}
                  />
                  <span className="naxatw-text-xs">{m.common_rejected()}</span>
                </div>
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                  <div
                    className="naxatw-h-3 naxatw-w-3 naxatw-rounded-full"
                    style={{ backgroundColor: "#eab308" }}
                  />
                  <span className="naxatw-text-xs">{m.common_unmatched()}</span>
                </div>
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                  <div
                    className="naxatw-h-3 naxatw-w-3 naxatw-rounded-full"
                    style={{ backgroundColor: "#f97316" }}
                  />
                  <span className="naxatw-text-xs">{m.common_invalid_exif()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* List Section - outer is a flex column with non-scrolling header and
            the virtualized accordion list owning its own scroll container. */}
        <div className="naxatw-flex naxatw-w-1/2 naxatw-min-h-0 naxatw-flex-col naxatw-pr-2">
          <FlexRow className="naxatw-mb-3 naxatw-shrink-0 naxatw-items-center naxatw-justify-between">
            <div className="naxatw-flex naxatw-flex-col naxatw-gap-2">
              <p className="naxatw-text-sm naxatw-text-[#484848]">
                {m.image_review_review_grouped_images()}
              </p>
              <p className="naxatw-text-xs naxatw-text-gray-500">
                {m.image_review_double_click_thumbnail_help()}
              </p>
              <p className="naxatw-text-xs naxatw-text-gray-500">
                {m.image_review_select_sequence_help()}
              </p>
              <label className="naxatw-flex naxatw-w-fit naxatw-cursor-pointer naxatw-items-center naxatw-gap-2 naxatw-rounded naxatw-border naxatw-border-gray-300 naxatw-px-3 naxatw-py-1.5 naxatw-text-sm naxatw-font-medium naxatw-text-gray-700 naxatw-transition-colors hover:naxatw-border-red hover:naxatw-text-gray-900">
                <span
                  className={`naxatw-flex naxatw-h-4 naxatw-w-4 naxatw-shrink-0 naxatw-items-center naxatw-justify-center naxatw-rounded naxatw-border-2 naxatw-text-white naxatw-transition-colors ${
                    showOnlyIssueImages
                      ? "naxatw-border-red naxatw-bg-red"
                      : "naxatw-border-gray-400 naxatw-bg-white"
                  }`}
                >
                  {showOnlyIssueImages && (
                    <svg className="naxatw-h-3 naxatw-w-3" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  className="naxatw-sr-only"
                  checked={showOnlyIssueImages}
                  onChange={(event) => setShowOnlyIssueImages(event.target.checked)}
                />
                {m.image_review_show_only_images_with_issues({
                  count: totalIssueImages,
                })}
              </label>
            </div>
            <FlexRow className="naxatw-items-start naxatw-gap-3 naxatw-text-xs">
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">
                  {showOnlyIssueImages ? visibleTaskCount : (reviewData?.total_tasks ?? "-")}
                </span>{" "}
                {m.common_tasks()}
              </span>
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">
                  {filteredLocatedImages.length}
                </span>{" "}
                {m.common_on_map()}
              </span>
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">
                  {totalIssueImages}
                </span>{" "}
                {m.common_issues()}
              </span>
            </FlexRow>
          </FlexRow>

          {/* Task Accordions - flex-1 + min-h-0 lets the virtualized list
              own a scroll container of the remaining height. */}
          <div className="naxatw-min-h-0 naxatw-flex-1">
            {reviewData ? (
              <VirtualizedAccordionList
                groups={displayedTaskGroups}
                openAccordions={openAccordions}
                setOpenAccordions={setOpenAccordions}
                showOnlyIssueImages={showOnlyIssueImages}
                projectId={projectId}
                highlightedImageId={highlightedImageId}
                selectedImageIds={selectedImageIds}
                sequenceSelectMode={sequenceSelectMode}
                sequenceAnchor={sequenceAnchor}
                imageRefs={imageRefs}
                onVerifyTask={(taskId, taskIndex) =>
                  setVerificationModal({ isOpen: true, taskId, taskIndex })
                }
                onCleanup={() => setShowCleanupConfirm(true)}
                onImageClick={handleSidebarImageClick}
                onImageDoubleClick={handleImageClick}
              />
            ) : (
              <div className="naxatw-flex naxatw-h-full naxatw-min-h-[200px] naxatw-items-center naxatw-justify-center">
                <p className="naxatw-text-sm naxatw-text-gray-500">
                  {m.image_review_loading_review_data()}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Image Modal */}
      {selectedImage && (
        <div
          className="naxatw-fixed naxatw-inset-0 naxatw-z-[9999] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-75"
          onClick={closeModal}
        >
          <div
            className="naxatw-relative naxatw-max-h-[90vh] naxatw-max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
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
                <p className="naxatw-mb-1 naxatw-text-xs naxatw-uppercase naxatw-tracking-wider naxatw-text-gray-300">
                  {m.common_status_label()} {selectedImage.status.replace("_", " ")}
                </p>
                {selectedImage.rejection_reason && (
                  <p className="naxatw-text-red-300 naxatw-text-sm">
                    {m.common_reason_label()} {selectedImage.rejection_reason}
                  </p>
                )}
                {isDuplicateImage && (
                  <p className="naxatw-text-sm naxatw-text-gray-300">
                    {m.image_review_duplicate_description()}
                  </p>
                )}
              </div>
              <div className="naxatw-flex naxatw-gap-2">
                {canOverride && (
                  <Button
                    variant="ghost"
                    className="naxatw-bg-green-600 naxatw-text-white hover:naxatw-bg-green-700"
                    onClick={handleAcceptImage}
                    disabled={acceptMutation.isPending}
                    leftIcon="check"
                  >
                    {acceptMutation.isPending
                      ? m.common_accepting()
                      : m.image_review_override_rejection()}
                  </Button>
                )}
                {canReject && (
                  <Button
                    variant="ghost"
                    className="naxatw-bg-red naxatw-text-white"
                    onClick={handleRejectImage}
                    disabled={rejectMutation.isPending}
                    leftIcon="block"
                  >
                    {rejectMutation.isPending
                      ? m.common_rejecting()
                      : m.image_review_reject_image()}
                  </Button>
                )}
                {canMatch && (
                  <Button
                    variant="ghost"
                    className="naxatw-bg-yellow-500 naxatw-text-white hover:naxatw-bg-yellow-600"
                    onClick={() => {
                      setTaskMatchingImage({
                        id: selectedImage.id,
                        filename: selectedImage.filename,
                      });
                      setSelectedImage(null);
                    }}
                    leftIcon="my_location"
                  >
                    {m.image_review_match_to_task()}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Task Verification Modal */}
      <TaskVerificationModal
        isOpen={verificationModal.isOpen}
        onClose={() => setVerificationModal({ isOpen: false, taskId: "", taskIndex: 0 })}
        projectId={projectId}
        taskId={verificationModal.taskId}
        taskIndex={verificationModal.taskIndex}
        onVerified={() => {
          queryClient.invalidateQueries({
            queryKey: ["projectReview", projectId],
          });
          queryClient.invalidateQueries({
            queryKey: ["projectMapData", projectId],
          });
          queryClient.invalidateQueries({
            queryKey: ["project-task-states", projectId],
          });
        }}
      />

      {/* Manual task assignment confirmation dialog */}
      {confirmMatch && (
        <div className="naxatw-fixed naxatw-inset-0 naxatw-z-[10000] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-50">
          <div className="naxatw-w-full naxatw-max-w-md naxatw-rounded-lg naxatw-bg-white naxatw-p-6 naxatw-shadow-xl">
            <div className="naxatw-mb-4 naxatw-flex naxatw-items-center naxatw-gap-3">
              <span className="material-icons naxatw-text-3xl naxatw-text-yellow-500">
                my_location
              </span>
              <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-900">
                {m.image_review_assign_image_title()}
              </h3>
            </div>
            <p className="naxatw-mb-2 naxatw-text-gray-600">
              {m.image_review_match_image_to_task({
                filename: confirmMatch.imageFilename,
                taskIndex: confirmMatch.taskIndex,
              })}
            </p>
            <p className="naxatw-mb-6 naxatw-text-xs naxatw-text-gray-400">
              {m.image_review_classification_override_notice()}
            </p>
            <div className="naxatw-flex naxatw-justify-end naxatw-gap-3">
              <Button
                variant="outline"
                className="naxatw-border-gray-300"
                onClick={() => setConfirmMatch(null)}
              >
                {m.common_cancel()}
              </Button>
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                onClick={() =>
                  assignTaskMutation.mutate({
                    imageId: confirmMatch.imageId,
                    taskId: confirmMatch.taskId,
                  })
                }
                disabled={assignTaskMutation.isPending}
                leftIcon="check"
              >
                {assignTaskMutation.isPending ? m.common_assigning() : m.common_confirm()}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk task assignment confirmation dialog */}
      {confirmBulkMatch && (
        <div className="naxatw-fixed naxatw-inset-0 naxatw-z-[10000] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-50">
          <div className="naxatw-w-full naxatw-max-w-md naxatw-rounded-lg naxatw-bg-white naxatw-p-6 naxatw-shadow-xl">
            <div className="naxatw-mb-4 naxatw-flex naxatw-items-center naxatw-gap-3">
              <span className="material-icons naxatw-text-3xl naxatw-text-yellow-500">
                my_location
              </span>
              <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-900">
                {m.image_review_assign_images_title({
                  count: confirmBulkMatch.imageIds.length,
                })}
              </h3>
            </div>
            <p className="naxatw-mb-2 naxatw-text-gray-600">
              {m.image_review_assign_unmatched_images_to_task({
                count: confirmBulkMatch.imageIds.length,
                taskIndex: confirmBulkMatch.taskIndex,
              })}
            </p>
            <p className="naxatw-mb-6 naxatw-text-xs naxatw-text-gray-400">
              {m.image_review_classification_override_each_notice()}
            </p>
            <div className="naxatw-flex naxatw-justify-end naxatw-gap-3">
              <Button
                variant="outline"
                className="naxatw-border-gray-300"
                onClick={() => setConfirmBulkMatch(null)}
                disabled={isBulkProcessing}
              >
                {m.common_cancel()}
              </Button>
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                onClick={handleBulkAssignConfirm}
                disabled={isBulkProcessing}
                leftIcon="check"
              >
                {isBulkProcessing ? m.common_assigning() : m.common_confirm()}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cleanup invalid imagery confirmation dialog */}
      {showCleanupConfirm && (
        <div className="naxatw-fixed naxatw-inset-0 naxatw-z-[10000] naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-black naxatw-bg-opacity-50">
          <div className="naxatw-w-full naxatw-max-w-md naxatw-rounded-lg naxatw-bg-white naxatw-p-6 naxatw-shadow-xl">
            <div className="naxatw-mb-4 naxatw-flex naxatw-items-center naxatw-gap-3">
              <span className="material-icons naxatw-text-red-500 naxatw-text-3xl">warning</span>
              <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-900">
                {m.image_review_cleanup_invalid_imagery()}
              </h3>
            </div>
            <p className="naxatw-mb-6 naxatw-text-gray-600">
              {m.image_review_cleanup_confirm_body()}
            </p>
            <div className="naxatw-flex naxatw-justify-end naxatw-gap-3">
              <Button
                variant="outline"
                className="naxatw-border-gray-300"
                onClick={() => setShowCleanupConfirm(false)}
                disabled={cleanupInvalidMutation.isPending}
              >
                {m.common_cancel()}
              </Button>
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                onClick={() => cleanupInvalidMutation.mutate()}
                disabled={cleanupInvalidMutation.isPending}
                leftIcon="delete"
              >
                {cleanupInvalidMutation.isPending ? m.common_deleting() : m.common_confirm()}
              </Button>
            </div>
          </div>
        </div>
      )}
    </FlexColumn>
  );
};

export default ImageReview;
