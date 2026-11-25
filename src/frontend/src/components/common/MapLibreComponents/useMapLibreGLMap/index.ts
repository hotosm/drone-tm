import { useEffect, useState } from "react";
import { Map, ScaleControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@Components/common/MapLibreComponents/map.css";
import { IMapOptionsProps, MapInstanceType } from "../types";

export default function useMapLibreGLMap({
  containerId = "maplibre-gl-map",
  mapOptions,
  enable3D = false,
  disableRotation = false,
}: IMapOptionsProps) {
  const [map, setMap] = useState<MapInstanceType | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState<Boolean>(false);

  // setup map instance
  useEffect(() => {
    const mapInstance = new Map({
      container: containerId,
      style: { version: 8, sources: {}, layers: [] },
      center: [0, 0],
      zoom: 1,
      attributionControl: false,
      maxBounds: [
        [-179, -89],
        [179, 89],
      ],
      preserveDrawingBuffer: true,
      ...mapOptions,
    });
    setMap(mapInstance);

    // add scale bar (bottom-left is taken by the project map legend)
    mapInstance.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");

    mapInstance.on("load", () => {
      // Mapterhorn: global open terrain (terrarium-encoded), orthos drape on top
      mapInstance.addSource("terrainSource", {
        type: "raster-dem",
        url: "https://tiles.mapterhorn.com/tilejson.json",
      });
      setIsMapLoaded(true);
    });
  }, []); // eslint-disable-line

  // toggle 3D terrain
  useEffect(() => {
    if (!map || !isMapLoaded) return;
    // @ts-ignore
    map.setTerrain(enable3D ? { source: "terrainSource", exaggeration: 1 } : null);
  }, [map, isMapLoaded, enable3D]);

  // disable map pane rotation
  useEffect(() => {
    if (!map || !disableRotation) return;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
  }, [map, disableRotation]);

  return { map, isMapLoaded };
}
