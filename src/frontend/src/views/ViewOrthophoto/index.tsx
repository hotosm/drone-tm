import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import maplibregl, { LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { cogProtocol } from "@geomatico/maplibre-cog-protocol";
import bbox from "@turf/bbox";
import { useGetProjectsDetailQuery } from "@Api/projects";
import { getOrthophotoCogPresignedUrl } from "@Services/createproject";
import hasErrorBoundary from "@Utils/hasErrorBoundary";

// Register the cog:// protocol exactly once per page load. addProtocol on
// MapLibre is process-global; calling it on every viewer mount would leak.
let cogProtocolRegistered = false;
function ensureCogProtocol() {
  if (cogProtocolRegistered) return;
  maplibregl.addProtocol("cog", cogProtocol);
  cogProtocolRegistered = true;
}

// Refresh the presigned URL with margin to spare so an in-flight range
// request never sees a 403 just after expiry.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const COG_SOURCE_ID = "ortho-cog-source";
const COG_LAYER_ID = "ortho-cog-layer";

type ViewState = "idle" | "loading" | "loaded" | "error" | "unavailable";

type CogUrlResponse = { url: string; expires_at: string };

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
  const refreshTimerRef = useRef<number | null>(null);
  const [viewState, setViewState] = useState<ViewState>("idle");

  const { data: projectData, isFetching } = useGetProjectsDetailQuery(id as string);

  useEffect(() => {
    ensureCogProtocol();
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || isFetching || !projectData) return;
    if (mapRef.current) return;

    const projectId = (projectData as Record<string, any>).id as string;
    const outline = (projectData as Record<string, any>).outline as
      | GeoJSON.Feature
      | GeoJSON.FeatureCollection
      | undefined;

    let cancelled = false;

    // Initial centre: prefer the project outline bounds so the user lands on
    // the area of interest immediately; otherwise default to a neutral view.
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

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://tiles.openfreemap.org/styles/bright",
      zoom: 14,
      center: initialCenter,
    });
    mapRef.current = map;

    function scheduleRefresh(expiresAt: number) {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
      const refreshInput = Math.max(60_000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
      refreshTimerRef.current = window.setTimeout(async () => {
        try {
          const res = await getOrthophotoCogPresignedUrl(projectId);
          const { url, expires_at } = res.data as CogUrlResponse;
          if (cancelled || !mapRef.current) return;
          addOrUpdateCogLayer(mapRef.current, url);
          scheduleRefresh(new Date(expires_at).getTime());
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("Failed to refresh orthophoto COG URL", err);
        }
      }, refreshInput);
    }

    async function loadCog() {
      setViewState("loading");
      try {
        const res = await getOrthophotoCogPresignedUrl(projectId);
        const { url, expires_at } = res.data as CogUrlResponse;
        if (cancelled || !mapRef.current) return;
        addOrUpdateCogLayer(mapRef.current, url);
        if (initialBounds) {
          mapRef.current.fitBounds(initialBounds, { padding: 40, animate: false });
        }
        setViewState("loaded");
        scheduleRefresh(new Date(expires_at).getTime());
      } catch (err: any) {
        if (cancelled) return;
        if (err?.response?.status === 404) {
          setViewState("unavailable");
        } else {
          // eslint-disable-next-line no-console
          console.error("Failed to load orthophoto COG", err);
          setViewState("error");
        }
      }
    }

    if (map.loaded()) {
      loadCog();
    } else {
      map.once("load", loadCog);
    }

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [projectData, isFetching]);

  const projectName = (projectData as Record<string, any>)?.name as string | undefined;

  return (
    <div className="naxatw-relative naxatw-flex naxatw-h-screen naxatw-flex-col">
      <div className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-border-b naxatw-bg-white naxatw-px-6 naxatw-py-3">
        <button
          type="button"
          aria-label="Back to project"
          className="material-icons naxatw-cursor-pointer naxatw-text-[#D73F3F] hover:naxatw-opacity-75"
          onClick={() => navigate(`/projects/${id}`)}
        >
          arrow_back
        </button>
        <span className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-800">
          {projectName ? `${projectName} - Orthophoto` : "Orthophoto Viewer"}
        </span>
      </div>

      <div className="naxatw-relative naxatw-flex-1">
        <div ref={mapContainerRef} className="naxatw-h-full naxatw-w-full" />

        {isFetching && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-white/70">
            <span className="naxatw-text-sm naxatw-text-gray-600">Loading project…</span>
          </div>
        )}

        {!isFetching && viewState === "loading" && (
          <div className="naxatw-pointer-events-none naxatw-absolute naxatw-bottom-8 naxatw-left-1/2 naxatw-z-10 -naxatw-translate-x-1/2 naxatw-rounded naxatw-bg-white/90 naxatw-px-4 naxatw-py-2 naxatw-text-sm naxatw-text-gray-700 naxatw-shadow">
            Loading orthophoto…
          </div>
        )}

        {!isFetching && viewState === "unavailable" && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center">
            <div className="naxatw-rounded-lg naxatw-bg-white naxatw-p-8 naxatw-text-center naxatw-shadow-xl">
              <span className="material-icons naxatw-mb-3 naxatw-block naxatw-text-4xl naxatw-text-gray-400">
                image
              </span>
              <p className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-700">
                Orthophoto not yet generated
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-gray-500">
                The orthophoto will be available once final processing completes.
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
                Failed to load orthophoto
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-gray-500">
                Try refreshing the page. If the problem persists, check the project&apos;s COG in
                S3.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default hasErrorBoundary(ViewOrthophoto);
