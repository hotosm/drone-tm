import type { IControl, Map as MlMap } from "maplibre-gl";

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
