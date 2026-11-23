import type { IControl, Map as MlMap, StyleSpecification } from "maplibre-gl";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_IMAGERY_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export function basemapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [OSM_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
      // Esri serves placeholder tiles past z19 in many areas
      imagery: {
        type: "raster",
        tiles: [ESRI_IMAGERY_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Esri, Vantor, Earthstar Geographics, and the GIS User Community",
      },
    },
    layers: [
      { id: "osm", type: "raster", source: "osm" },
      { id: "imagery", type: "raster", source: "imagery", layout: { visibility: "none" } },
    ],
  };
}

export class BasemapToggle implements IControl {
  private container = document.createElement("div");

  onAdd(map: MlMap): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "basemap-toggle";
    button.title = "Satellite imagery";
    button.setAttribute("aria-label", "Satellite imagery");
    button.innerHTML = '<wa-icon name="layer-group"></wa-icon>';
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      const showImagery = map.getLayoutProperty("imagery", "visibility") === "none";
      map.setLayoutProperty("imagery", "visibility", showImagery ? "visible" : "none");
      map.setLayoutProperty("osm", "visibility", showImagery ? "none" : "visible");
      button.setAttribute("aria-pressed", String(showImagery));
    });
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.container.append(button);
    return this.container;
  }

  onRemove(): void {
    this.container.remove();
  }
}
