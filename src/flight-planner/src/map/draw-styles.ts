// MapLibre requires line-dasharray values wrapped in a literal expression.

import { mapColor } from "./palette";

export function drawStyles() {
  const ACTIVE = mapColor("photo");
  const INACTIVE = mapColor("path");
  const WHITE = mapColor("white");
  const STATIC = mapColor("static");

  return [
    {
      id: "gl-draw-polygon-fill-inactive",
      type: "fill",
      filter: [
        "all",
        ["==", "active", "false"],
        ["==", "$type", "Polygon"],
        ["!=", "mode", "static"],
      ],
      paint: { "fill-color": INACTIVE, "fill-outline-color": INACTIVE, "fill-opacity": 0.12 },
    },
    {
      id: "gl-draw-polygon-fill-active",
      type: "fill",
      filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
      paint: { "fill-color": ACTIVE, "fill-outline-color": ACTIVE, "fill-opacity": 0.12 },
    },
    {
      id: "gl-draw-polygon-midpoint",
      type: "circle",
      filter: ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
      paint: { "circle-radius": 4, "circle-color": ACTIVE },
    },
    {
      id: "gl-draw-polygon-stroke-inactive",
      type: "line",
      filter: [
        "all",
        ["==", "active", "false"],
        ["==", "$type", "Polygon"],
        ["!=", "mode", "static"],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": INACTIVE, "line-width": 2 },
    },
    {
      id: "gl-draw-polygon-stroke-active",
      type: "line",
      filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ACTIVE, "line-dasharray": ["literal", [0.2, 2]], "line-width": 2 },
    },
    {
      id: "gl-draw-line-inactive",
      type: "line",
      filter: [
        "all",
        ["==", "active", "false"],
        ["==", "$type", "LineString"],
        ["!=", "mode", "static"],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": INACTIVE, "line-width": 2 },
    },
    {
      id: "gl-draw-line-active",
      type: "line",
      filter: ["all", ["==", "$type", "LineString"], ["==", "active", "true"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ACTIVE, "line-dasharray": ["literal", [0.2, 2]], "line-width": 2 },
    },
    {
      id: "gl-draw-polygon-and-line-vertex-stroke-inactive",
      type: "circle",
      filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
      paint: { "circle-radius": 6, "circle-color": WHITE },
    },
    {
      id: "gl-draw-polygon-and-line-vertex-inactive",
      type: "circle",
      filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"], ["!=", "mode", "static"]],
      paint: { "circle-radius": 4, "circle-color": ACTIVE },
    },
    {
      id: "gl-draw-polygon-fill-static",
      type: "fill",
      filter: ["all", ["==", "mode", "static"], ["==", "$type", "Polygon"]],
      paint: { "fill-color": STATIC, "fill-outline-color": STATIC, "fill-opacity": 0.1 },
    },
    {
      id: "gl-draw-polygon-stroke-static",
      type: "line",
      filter: ["all", ["==", "mode", "static"], ["==", "$type", "Polygon"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": STATIC, "line-width": 2 },
    },
  ];
}
