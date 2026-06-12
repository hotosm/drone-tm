import { FeatureCollection } from "geojson";
import marker from "@Assets/images/marker.png";
import right from "@Assets/images/rightArrow.png";
import VectorLayer from "./VectorLayer";

interface FlightPlanLayersProps {
  geojsonListOfPoints: FeatureCollection;
  geojsonAsLineString: FeatureCollection;
  pointsInteractive?: boolean;
}

/**
 * Flight plan visualization: dashed waylines with direction arrows,
 * waypoint circles (take-off and landing hidden), and a take-off marker.
 * Shared between the task operator map and the public try-drone map.
 */
export default function FlightPlanLayers({
  geojsonListOfPoints,
  geojsonAsLineString,
  pointsInteractive = false,
}: FlightPlanLayersProps) {
  const lastPointIndex = geojsonListOfPoints.features.length - 1;

  return (
    <>
      <VectorLayer
        id="waypoint-line"
        geojson={geojsonAsLineString}
        visibleOnMap
        layerOptions={{
          type: "line",
          paint: {
            "line-color": "#000000",
            "line-width": 1,
            "line-dasharray": [6, 3],
          },
        }}
        hasImage
        image={right}
        symbolPlacement="line"
        iconAnchor="center"
      />
      <VectorLayer
        id="waypoint-points"
        geojson={geojsonListOfPoints}
        visibleOnMap
        interactions={pointsInteractive ? ["feature"] : []}
        layerOptions={{
          type: "circle",
          paint: {
            "circle-color": "#176149",
            "circle-stroke-width": 2,
            "circle-stroke-color": "red",
            "circle-stroke-opacity": 1,
            "circle-opacity": ["match", ["get", "index"], 0, 0, lastPointIndex, 0, 1],
          },
        }}
      />
      <VectorLayer
        id="waypoint-points-image"
        geojson={geojsonListOfPoints}
        visibleOnMap
        layerOptions={{}}
        hasImage
        image={marker}
        iconAnchor="bottom"
        imageLayerOptions={{
          filter: ["==", "index", 0],
        }}
      />
    </>
  );
}
