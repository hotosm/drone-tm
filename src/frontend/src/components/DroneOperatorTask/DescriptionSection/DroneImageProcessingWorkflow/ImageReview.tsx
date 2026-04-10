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
  assignImageToTask,
  deleteInvalidImages,
  ProjectReviewData,
  ProjectMapData,
  TaskGroup,
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
import TaskVerificationModal from "./TaskVerificationModal";

interface ImageReviewProps {
  projectId: string;
}

const hasIssueStatus = (status?: string) => status !== "assigned";
const canManuallyMatchImage = (status?: string) => status === "unmatched";
const canOverrideImageRejection = (status?: string) =>
  status === "rejected" || status === "invalid_exif";

// Accordion content that lazy-loads presigned thumbnail URLs when opened
const TaskAccordionContent = ({
  group,
  projectId,
  isOpen,
  highlightedImageId,
  imageRefs,
  onVerifyTask,
  onCleanup,
  onImageClick,
  onImageDoubleClick,
}: {
  group: TaskGroup;
  projectId: string;
  isOpen: boolean;
  highlightedImageId: string | null;
  imageRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onVerifyTask: (taskId: string, taskIndex: number) => void;
  onCleanup: () => void;
  onImageClick: (image: TaskGroupImage, imageUrls?: Record<string, ImageUrls>) => void;
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
            Verify Task on Map
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
            Cleanup Invalid Imagery
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
                  return (
                    <div
                      key={image.id}
                      ref={(el) => {
                        imageRefs.current[image.id] = el;
                      }}
                      className={`naxatw-group naxatw-relative naxatw-aspect-square naxatw-cursor-pointer naxatw-overflow-hidden naxatw-rounded naxatw-border-2 naxatw-transition-all hover:naxatw-shadow-md ${
                        highlightedImageId === image.id
                          ? "naxatw-border-blue-500 naxatw-ring-2 naxatw-ring-blue-300"
                          : image.status === "rejected" || image.status === "invalid_exif"
                            ? "naxatw-border-red-300 hover:naxatw-border-red-500"
                            : image.status === "unmatched"
                              ? "naxatw-border-yellow-300 hover:naxatw-border-yellow-500"
                              : image.status === "duplicate"
                                ? "naxatw-border-gray-400 hover:naxatw-border-gray-600 naxatw-opacity-60"
                                : "naxatw-border-gray-200 hover:naxatw-border-blue-500"
                      }`}
                      onClick={() => onImageClick(image, imageUrlMap)}
                      onDoubleClick={() => onImageDoubleClick(image, imageUrlMap)}
                      title={`${image.filename}${image.rejection_reason ? ` - ${image.rejection_reason}` : ""} (double-click to view)`}
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
                          <span className="naxatw-text-[9px] naxatw-mt-0.5">Duplicate</span>
                        </div>
                      ) : (
                        <div className="naxatw-flex naxatw-h-full naxatw-w-full naxatw-items-center naxatw-justify-center naxatw-bg-gray-100">
                          <div className="naxatw-h-5 naxatw-w-5 naxatw-animate-spin naxatw-rounded-full naxatw-border-2 naxatw-border-gray-300 naxatw-border-t-blue-500" />
                        </div>
                      )}
                      {(image.status === "rejected" || image.status === "invalid_exif") && (
                        <div className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-red-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white naxatw-truncate">
                          {image.rejection_reason || "Rejected"}
                        </div>
                      )}
                      {image.status === "unmatched" && (
                        <div className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-yellow-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white">
                          Unmatched
                        </div>
                      )}
                      {image.status === "duplicate" && (
                        <div className="naxatw-absolute naxatw-bottom-0 naxatw-left-0 naxatw-right-0 naxatw-bg-gray-500 naxatw-bg-opacity-75 naxatw-px-1 naxatw-py-0.5 naxatw-text-center naxatw-text-[10px] naxatw-text-white">
                          Duplicate
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

  const isLoading = isMapDataLoading || isReviewLoading;
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
      const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
      if (!features?.length) return;

      const props = features[0].properties;
      const coords = (features[0].geometry as any).coordinates.slice();

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

  // Update map highlight when highlightedImageId changes
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const layerId = "review-image-points-layer";

    try {
      if (!map.getLayer(layerId)) return;

      if (highlightedImageId) {
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
  }, [map, isMapLoaded, highlightedImageId]);

  // Task picker mode: highlight tasks on hover and handle click to select
  useEffect(() => {
    if (!map || !isMapLoaded) return;

    const fillLayerId = "review-task-polygons-layer";
    const isPickerActive = () => !!taskMatchingImageRef.current;

    const onMouseMove = (e: any) => {
      if (!isPickerActive()) return;
      const features = map.queryRenderedFeatures(e.point, { layers: [fillLayerId] });
      map.getCanvas().style.cursor = features?.length ? "crosshair" : "crosshair";
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
      const features = map.queryRenderedFeatures(e.point, { layers: [fillLayerId] });
      if (!features?.length) return;
      const taskProps = features[0].properties;
      const matching = taskMatchingImageRef.current;
      if (matching && taskProps) {
        setConfirmMatch({
          imageId: matching.id,
          imageFilename: matching.filename,
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

  // Update cursor when entering/leaving picker mode
  useEffect(() => {
    if (!map) return;
    map.getCanvas().style.cursor = taskMatchingImage ? "crosshair" : "";
  }, [map, taskMatchingImage]);

  const acceptMutation = useMutation({
    mutationFn: (imageId: string) => acceptImage(projectId, imageId),
    onSuccess: (data) => {
      if (data.status === "unmatched") {
        toast.warning(data.message);
      } else {
        toast.success("Image accepted successfully");
      }
      queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projectMapData", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-task-states", projectId] });
      setSelectedImage(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.detail || error.message || "Failed to accept image";
      toast.error(message);
    },
  });

  const assignTaskMutation = useMutation({
    mutationFn: ({ imageId, taskId }: { imageId: string; taskId: string }) =>
      assignImageToTask(projectId, imageId, taskId),
    onSuccess: () => {
      toast.success("Image assigned to task successfully");
      queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projectMapData", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-task-states", projectId] });
      setConfirmMatch(null);
      setTaskMatchingImage(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.detail || error.message || "Failed to assign image";
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
          `Deleted ${data.deleted_count} invalid image${data.deleted_count === 1 ? "" : "s"}`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projectMapData", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project-task-states", projectId] });
      setShowCleanupConfirm(false);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.detail || error.message || "Failed to delete invalid images";
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

  // Handle sidebar thumbnail click: highlight on map and fly to it
  const handleSidebarImageClick = (
    image: TaskGroupImage,
    _imageUrls?: Record<string, ImageUrls>,
  ) => {
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
          Error loading review data: {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  if (!reviewData || reviewData.task_groups.length === 0) {
    return (
      <div className="naxatw-flex naxatw-min-h-[400px] naxatw-items-center naxatw-justify-center">
        <p className="naxatw-text-gray-500">No classified images available for review.</p>
      </div>
    );
  }

  const isRejectedImage = selectedImage && canOverrideImageRejection(selectedImage.status);
  const isUnmatchedImage = selectedImage && selectedImage.status === "unmatched";
  const isDuplicateImage = selectedImage && selectedImage.status === "duplicate";
  const canOverride = isRejectedImage && !isDuplicateImage;
  const canMatch = isUnmatchedImage;

  const locatedImages =
    mapData?.images?.features?.filter(
      (feature: GeoJSON.Feature<any>) => feature.geometry !== null,
    ) || [];

  // Collect unlocated images with their thumbnail data from map API
  const unlocatedImages =
    mapData?.images?.features?.filter(
      (feature: GeoJSON.Feature<any>) => feature.geometry === null,
    ) || [];

  const filteredLocatedImages = showOnlyIssueImages
    ? locatedImages.filter((feature: GeoJSON.Feature<any>) =>
        hasIssueStatus(feature.properties?.status),
      )
    : locatedImages;

  const filteredUnlocatedImages = showOnlyIssueImages
    ? unlocatedImages.filter((feature: GeoJSON.Feature<any>) =>
        hasIssueStatus(feature.properties?.status),
      )
    : unlocatedImages;

  const locatedImagesGeojson: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
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
        .filter(
          (feature: GeoJSON.Feature<any>) =>
            !group.images.some((img) => img.id === feature.properties?.id),
        )
        .map((feature: GeoJSON.Feature<any>) => {
          const props = feature.properties || {};
          return {
            id: props.id,
            filename: props.filename || "Unknown",
            status: props.status || "unmatched",
            rejection_reason: props.rejection_reason || "No GPS",
            uploaded_at: props.uploaded_at || "",
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
      (count: number, group: TaskGroup) =>
        count + group.images.filter((image) => hasIssueStatus(image.status)).length,
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
          <div
            className="naxatw-flex-1 naxatw-relative"
            style={{ display: "flex", flexDirection: "column", minHeight: "400px" }}
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
              <div className="naxatw-absolute naxatw-inset-0 naxatw-z-20 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-white naxatw-bg-opacity-75 naxatw-rounded">
                <div className="naxatw-flex naxatw-flex-col naxatw-items-center naxatw-gap-2">
                  <div className="naxatw-animate-spin naxatw-text-gray-400">
                    <span className="material-icons">refresh</span>
                  </div>
                  <p className="naxatw-text-sm naxatw-text-gray-600">Loading map data...</p>
                </div>
              </div>
            )}

            {/* Task picker mode banner */}
            {taskMatchingImage && (
              <div className="naxatw-absolute naxatw-top-2 naxatw-left-2 naxatw-right-2 naxatw-z-20 naxatw-flex naxatw-items-center naxatw-justify-between naxatw-rounded naxatw-bg-yellow-500 naxatw-px-4 naxatw-py-2 naxatw-shadow-lg">
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2 naxatw-text-sm naxatw-font-medium naxatw-text-white">
                  <span className="material-icons naxatw-text-base">my_location</span>
                  Click a task area to assign{" "}
                  <span className="naxatw-font-bold">{taskMatchingImage.filename}</span>
                </div>
                <button
                  onClick={() => setTaskMatchingImage(null)}
                  className="naxatw-rounded naxatw-bg-white naxatw-bg-opacity-20 naxatw-px-3 naxatw-py-1 naxatw-text-xs naxatw-font-semibold naxatw-text-white hover:naxatw-bg-opacity-30"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Legend */}
            <div className="naxatw-absolute naxatw-bottom-8 naxatw-left-2 naxatw-z-10 naxatw-rounded naxatw-bg-white naxatw-p-2 naxatw-shadow-md">
              <p className="naxatw-text-xs naxatw-font-semibold naxatw-mb-1">Image Status</p>
              <div className="naxatw-flex naxatw-flex-col naxatw-gap-1">
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                  <div
                    className="naxatw-w-3 naxatw-h-3 naxatw-rounded-full"
                    style={{ backgroundColor: "#22c55e" }}
                  />
                  <span className="naxatw-text-xs">Assigned</span>
                </div>
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                  <div
                    className="naxatw-w-3 naxatw-h-3 naxatw-rounded-full"
                    style={{ backgroundColor: "#D73F3F" }}
                  />
                  <span className="naxatw-text-xs">Rejected</span>
                </div>
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                  <div
                    className="naxatw-w-3 naxatw-h-3 naxatw-rounded-full"
                    style={{ backgroundColor: "#eab308" }}
                  />
                  <span className="naxatw-text-xs">Unmatched</span>
                </div>
                <div className="naxatw-flex naxatw-items-center naxatw-gap-2">
                  <div
                    className="naxatw-w-3 naxatw-h-3 naxatw-rounded-full"
                    style={{ backgroundColor: "#f97316" }}
                  />
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
                Double-click a thumbnail to inspect the full image and handle issues.
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
                Show only images with issues ({totalIssueImages})
              </label>
            </div>
            <FlexRow className="naxatw-gap-3 naxatw-text-xs naxatw-items-start">
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">
                  {showOnlyIssueImages ? visibleTaskCount : reviewData.total_tasks}
                </span>{" "}
                Tasks
              </span>
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">
                  {filteredLocatedImages.length}
                </span>{" "}
                on Map
              </span>
              <span className="naxatw-text-gray-600">
                <span className="naxatw-font-semibold naxatw-text-gray-900">
                  {totalIssueImages}
                </span>{" "}
                Issues
              </span>
            </FlexRow>
          </FlexRow>

          {/* Task Accordions */}
          <div className="naxatw-flex naxatw-flex-col">
            {displayedTaskGroups.map((group: TaskGroup, index: number) => {
              const accordionKey = group.task_id || `unassigned-${index}`;
              const isAccordionOpen = openAccordions.has(accordionKey);
              return (
                <Accordion
                  key={accordionKey}
                  open={false}
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
                        {group.task_id ? `Task #${group.project_task_index}` : "Unassigned Images"}
                      </h4>
                      <span className="naxatw-rounded-full naxatw-bg-blue-100 naxatw-px-3 naxatw-py-1 naxatw-text-sm naxatw-font-medium naxatw-text-blue-800">
                        {showOnlyIssueImages
                          ? `${group.images.length} ${group.images.length === 1 ? "issue" : "issues"}`
                          : `${group.images.length} ${group.images.length === 1 ? "image" : "images"}`}
                      </span>
                      {group.is_verified && (
                        <span className="naxatw-rounded-full naxatw-bg-green-100 naxatw-px-3 naxatw-py-1 naxatw-text-sm naxatw-font-medium naxatw-text-green-800">
                          Fully Flown
                        </span>
                      )}
                    </FlexRow>
                  }
                >
                  <TaskAccordionContent
                    group={group}
                    projectId={projectId}
                    isOpen={isAccordionOpen}
                    highlightedImageId={highlightedImageId}
                    imageRefs={imageRefs}
                    onVerifyTask={(taskId, taskIndex) =>
                      setVerificationModal({ isOpen: true, taskId, taskIndex })
                    }
                    onCleanup={() => setShowCleanupConfirm(true)}
                    onImageClick={handleSidebarImageClick}
                    onImageDoubleClick={handleImageClick}
                  />
                </Accordion>
              );
            })}
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
                <p className="naxatw-text-xs naxatw-uppercase naxatw-tracking-wider naxatw-text-gray-300 naxatw-mb-1">
                  Status: {selectedImage.status.replace("_", " ")}
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
              <div className="naxatw-flex naxatw-gap-2">
                {canOverride && (
                  <Button
                    variant="ghost"
                    className="naxatw-bg-green-600 naxatw-text-white hover:naxatw-bg-green-700"
                    onClick={handleAcceptImage}
                    disabled={acceptMutation.isPending}
                    leftIcon="check"
                  >
                    {acceptMutation.isPending ? "Accepting..." : "Override rejection"}
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
                    Match to task
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
          queryClient.invalidateQueries({ queryKey: ["projectReview", projectId] });
          queryClient.invalidateQueries({ queryKey: ["projectMapData", projectId] });
          queryClient.invalidateQueries({ queryKey: ["project-task-states", projectId] });
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
                Assign image to task?
              </h3>
            </div>
            <p className="naxatw-mb-2 naxatw-text-gray-600">
              Match <span className="naxatw-font-semibold">{confirmMatch.imageFilename}</span> to{" "}
              <span className="naxatw-font-semibold">Task #{confirmMatch.taskIndex}</span>?
            </p>
            <p className="naxatw-mb-6 naxatw-text-xs naxatw-text-gray-400">
              This will override the automatic classification result.
            </p>
            <div className="naxatw-flex naxatw-justify-end naxatw-gap-3">
              <Button
                variant="outline"
                className="naxatw-border-gray-300"
                onClick={() => setConfirmMatch(null)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={() =>
                  assignTaskMutation.mutate({
                    imageId: confirmMatch.imageId,
                    taskId: confirmMatch.taskId,
                  })
                }
                disabled={assignTaskMutation.isPending}
                leftIcon="check"
              >
                {assignTaskMutation.isPending ? "Assigning..." : "Confirm"}
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
              <span className="material-icons naxatw-text-3xl naxatw-text-red-500">warning</span>
              <h3 className="naxatw-text-lg naxatw-font-semibold naxatw-text-gray-900">
                Cleanup Invalid Imagery
              </h3>
            </div>
            <p className="naxatw-mb-6 naxatw-text-gray-600">
              This will delete the imagery marked as invalid or unmatched during the uploading
              process. It is not reversible. Are you sure?
            </p>
            <div className="naxatw-flex naxatw-justify-end naxatw-gap-3">
              <Button
                variant="outline"
                className="naxatw-border-gray-300"
                onClick={() => setShowCleanupConfirm(false)}
                disabled={cleanupInvalidMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                className="naxatw-bg-red naxatw-text-white"
                onClick={() => cleanupInvalidMutation.mutate()}
                disabled={cleanupInvalidMutation.isPending}
                leftIcon="delete"
              >
                {cleanupInvalidMutation.isPending ? "Deleting..." : "OK"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </FlexColumn>
  );
};

export default ImageReview;
