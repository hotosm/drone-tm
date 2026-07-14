import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import maplibregl, { LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { cogProtocol, getCogMetadata } from "@geomatico/maplibre-cog-protocol";
import bbox from "@turf/bbox";
import { useGetProjectsDetailQuery } from "@Api/projects";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { m } from "@/paraglide/messages";

// Register the cog:// protocol exactly once per page load. addProtocol on
// MapLibre is process-global; calling it on every viewer mount would leak.
let cogProtocolRegistered = false;
function ensureCogProtocol() {
  if (cogProtocolRegistered) return;
  maplibregl.addProtocol("cog", cogProtocol);
  cogProtocolRegistered = true;
}

const COG_SOURCE_ID = "ortho-cog-source";
const COG_LAYER_ID = "ortho-cog-layer";

type ViewState = "idle" | "loading" | "loaded" | "error" | "unavailable";

function addOrUpdateCogLayer(map: maplibregl.Map, url: string) {
  const cogUrl = `cog://${url}`;
  if (map.getLayer(COG_LAYER_ID)) map.removeLayer(COG_LAYER_ID);
  if (map.getSource(COG_SOURCE_ID)) map.removeSource(COG_SOURCE_ID);
  map.addSource(COG_SOURCE_ID, {
    type: "raster",
    url: cogUrl,
    tileSize: 256,
  });
  map.addLayer({
    id: COG_LAYER_ID,
    type: "raster",
    source: COG_SOURCE_ID,
    paint: { "raster-opacity": 1 },
  });
}

const ViewOrthophoto = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Cached on initial load so the "zoom to extent" button can re-fit
  // without having to recompute from the project outline each click.
  const layerBoundsRef = useRef<LngLatBounds | null>(null);
  const [viewState, setViewState] = useState<ViewState>("idle");

  const { data: projectData, isFetching } = useGetProjectsDetailQuery(id as string);

  const handleZoomToExtent = useCallback(() => {
    if (!mapRef.current || !layerBoundsRef.current) return;
    mapRef.current.fitBounds(layerBoundsRef.current, { padding: 40, animate: true });
  }, []);

  useEffect(() => {
    ensureCogProtocol();
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || isFetching || !projectData) return;
    if (mapRef.current) return;

    // Backend exposes the COG via a direct publicuploads/ URL that never
    // expires, so the previous "fetch presigned URL + schedule refresh"
    // dance is gone. Absence of the URL means the cloudnative job hasn't
    // produced a COG for this project yet.
    const rawCogUrl = (projectData as Record<string, any>).cloud_ortho_cog_url as
      | string
      | null
      | undefined;
    if (!rawCogUrl) {
      setViewState("unavailable");
      return;
    }
    const cogUrl: string = rawCogUrl;

    const outline = (projectData as Record<string, any>).outline as
      | GeoJSON.Feature
      | GeoJSON.FeatureCollection
      | undefined;

    let cancelled = false;

    // Initial centre: prefer the project outline bounds so the user lands on
    // the area of interest immediately; otherwise default to a neutral view.
    // The COG covers exactly the project AOI by construction, so the outline
    // bbox doubles as the "zoom to layer extent" target.
    let initialCenter: [number, number] = [0, 0];
    let initialBounds: LngLatBounds | null = null;
    if (outline) {
      try {
        const [minX, minY, maxX, maxY] = bbox(outline as any);
        initialBounds = new LngLatBounds([minX, minY], [maxX, maxY]);
        initialCenter = [(minX + maxX) / 2, (minY + maxY) / 2];
      } catch {
        // ignore
      }
    }
    layerBoundsRef.current = initialBounds;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://tiles.openfreemap.org/styles/bright",
      zoom: 14,
      center: initialCenter,
    });
    mapRef.current = map;

    function loadCog() {
      if (cancelled || !mapRef.current) return;
      setViewState("loading");
      try {
        addOrUpdateCogLayer(mapRef.current, cogUrl);
        // Initial fit uses the project outline - it's already in hand, so
        // the map paints immediately. The actual COG extent is fetched
        // below; it'll be slightly different (ODM clips/buffers around the
        // AOI) and the button uses whichever is most recently known.
        if (initialBounds) {
          mapRef.current.fitBounds(initialBounds, { padding: 40, animate: false });
        }
        setViewState("loaded");
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("Failed to load orthophoto COG", err);
        setViewState("error");
      }

      // Upgrade the cached extent from outline-approximation to the actual
      // COG bbox once metadata is back (range request to COG header, no
      // tile fetch). Fire-and-forget - initial paint already happened.
      getCogMetadata(cogUrl)
        .then((metadata) => {
          if (cancelled || !metadata?.bbox) return;
          const [west, south, east, north] = metadata.bbox;
          layerBoundsRef.current = new LngLatBounds([west, south], [east, north]);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("Failed to read COG metadata; zoom-to-extent will use project outline", err);
        });
    }

    if (map.loaded()) {
      loadCog();
    } else {
      map.once("load", loadCog);
    }

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
      layerBoundsRef.current = null;
    };
  }, [projectData, isFetching]);

  const projectName = (projectData as Record<string, any>)?.name as string | undefined;

  return (
    <div className="naxatw-relative naxatw-flex naxatw-h-screen naxatw-flex-col">
      <div className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-border-b naxatw-bg-white naxatw-px-6 naxatw-py-3">
        <button
          type="button"
          aria-label={m.viewer_back_to_project()}
          className="material-icons naxatw-cursor-pointer naxatw-text-[#D73F3F] hover:naxatw-opacity-75"
          onClick={() => navigate(`/projects/${id}`)}
        >
          arrow_back
        </button>
        <span className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-800">
          {projectName
            ? m.viewer_orthophoto_title({ projectName })
            : m.viewer_orthophoto_fallback_title()}
        </span>
      </div>

      <div className="naxatw-relative naxatw-flex-1">
        <div ref={mapContainerRef} className="naxatw-h-full naxatw-w-full" />

        {viewState === "loaded" && (
          <button
            type="button"
            aria-label={m.viewer_orthophoto_zoom_extent()}
            title={m.viewer_orthophoto_zoom_extent()}
            className="naxatw-absolute naxatw-right-4 naxatw-top-4 naxatw-z-10 naxatw-flex naxatw-h-10 naxatw-w-10 naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-white naxatw-shadow-lg hover:naxatw-bg-gray-50"
            onClick={handleZoomToExtent}
          >
            <span className="material-icons naxatw-text-[#D73F3F]">center_focus_strong</span>
          </button>
        )}

        {isFetching && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-white/70">
            <span className="naxatw-text-sm naxatw-text-gray-600">
              {m.viewer_loading_project()}
            </span>
          </div>
        )}

        {!isFetching && viewState === "loading" && (
          <div className="naxatw-pointer-events-none naxatw-absolute naxatw-bottom-8 naxatw-left-1/2 naxatw-z-10 -naxatw-translate-x-1/2 naxatw-rounded naxatw-bg-white/90 naxatw-px-4 naxatw-py-2 naxatw-text-sm naxatw-text-gray-700 naxatw-shadow">
            {m.viewer_orthophoto_loading()}
          </div>
        )}

        {!isFetching && viewState === "unavailable" && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center">
            <div className="naxatw-rounded-lg naxatw-bg-white naxatw-p-8 naxatw-text-center naxatw-shadow-xl">
              <span className="material-icons naxatw-mb-3 naxatw-block naxatw-text-4xl naxatw-text-gray-400">
                image
              </span>
              <p className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-700">
                {m.viewer_orthophoto_unavailable_title()}
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-gray-500">
                {m.viewer_orthophoto_unavailable_description()}
              </p>
            </div>
          </div>
        )}

        {!isFetching && viewState === "error" && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center">
            <div className="naxatw-rounded-lg naxatw-bg-white naxatw-p-8 naxatw-text-center naxatw-shadow-xl">
              <span className="material-icons naxatw-mb-3 naxatw-block naxatw-text-4xl naxatw-text-red-500">
                error_outline
              </span>
              <p className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-700">
                {m.viewer_orthophoto_load_failed()}
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-gray-500">
                {m.viewer_orthophoto_retry_refresh()}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default hasErrorBoundary(ViewOrthophoto);
