import { css, html, LitElement, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import maplibregl, { Map, Popup } from "maplibre-gl";
// @ts-ignore - virtual module resolved by esbuild plugin, inlines maplibre CSS for shadow DOM
import maplibreCss from "maplibre-gl-css";
import { cogProtocol } from "@geomatico/maplibre-cog-protocol";
import { Store } from "../../store";
import MarkerIcon from "../../assets/markerIcon.png";
import uploadImage from "../../assets/uploadIcon.png";
import layerSwitcher from "../../assets/layers.png";

const BASE_LAYERS = ["osm", "satellite", "topo", "hybrid"] as const;

@customElement("map-section")
export class MapSection extends LitElement {
  @property({ type: Object }) gcpPointGeojson: any = Store.getGcpGeojson();
  @property({ type: Object }) cogUrl: string = Store.getCogUrl();
  @property({ type: String }) projection: string = Store.getProjection();
  @state() activeGcp: any;
  @state() showBaseLayerList: boolean = false;

  private map!: Map;
  private popup!: Popup;
  private gcpGeojsonData: any = null;
  private _boundHandleGcpSelection = this.handleGcpSelection.bind(this);

  static styles = css`
    ${unsafeCSS(maplibreCss)}
    :host {
      display: block;
      padding: 10px;
      height: 100%;
      width: 100%;
    }
    #map-container {
      display: flex;
      min-height: 40vh;
      height: 100%;
      width: 100%;
      border-radius: 8px;
      overflow: hidden;
      position: relative;
    }
    #gcp-map-container {
      width: 100%;
      height: 100%;
    }
    .base-layer-list {
      position: absolute;
      left: 35px;
      top: 0px;
      background: white;
      display: none;
      flex-direction: column;
      width: 120px;
      padding: 10px 10px;
      border-radius: 8px;
      z-index: 1;
    }
    .layer-switcher {
      position: absolute;
      top: 70px;
      left: 10px;
      height: 24px;
      width: 24px;
      background-color: white;
      padding: 4px 4px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 1;
    }
    .layer-switcher:hover {
      background: #f7f6eb;
      cursor: pointer;
    }

    .layer-switcher > input,
    label:hover {
      cursor: pointer;
      background: #f7f6eb;
    }

    .layer-switcher > img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  `;

  firstUpdated(): void {
    const container = this.renderRoot.querySelector("#gcp-map-container") as HTMLElement;
    this.gcpPointGeojson = Store.getGcpGeojson();
    this.projection = Store.getProjection();

    this.map = new Map({
      container,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [0, 0],
      zoom: 2,
    });

    this.map.on("load", () => {
      this.addBaseLayers();
      this.setupLayerSwitcher();
      this.loadGcpPoints(this.gcpPointGeojson);
      if (this.cogUrl) {
        this.loadCog(this.cogUrl);
      }
      this.setupClickHandler();
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.activeGcp = Store.getActiveGcp();
    document.addEventListener(Store.ACTIVE_GCP_UPDATE, this._boundHandleGcpSelection);
  }

  disconnectedCallback() {
    document.removeEventListener(Store.ACTIVE_GCP_UPDATE, this._boundHandleGcpSelection);
    this.map?.remove();
    super.disconnectedCallback();
  }

  private addBaseLayers() {
    this.map.addSource("satellite", {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
    });
    this.map.addLayer({
      id: "satellite",
      type: "raster",
      source: "satellite",
      layout: { visibility: "none" },
    });

    this.map.addSource("topo", {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
    });
    this.map.addLayer({
      id: "topo",
      type: "raster",
      source: "topo",
      layout: { visibility: "none" },
    });

    this.map.addSource("hybrid", {
      type: "raster",
      tiles: ["https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}"],
      tileSize: 256,
    });
    this.map.addLayer({
      id: "hybrid",
      type: "raster",
      source: "hybrid",
      layout: { visibility: "none" },
    });
  }

  private setupLayerSwitcher() {
    const radioInputs = this.renderRoot.querySelectorAll(
      ".base-layer-list > label > input[type=radio]",
    ) as NodeListOf<HTMLInputElement>;

    for (const input of radioInputs) {
      input.addEventListener("change", () => {
        const selected = input.value;
        BASE_LAYERS.forEach((id) => {
          this.map.setLayoutProperty(id, "visibility", id === selected ? "visible" : "none");
        });
        this.showBaseLayerList = false;
      });
    }
  }

  private loadGcpPoints(geojson: any) {
    if (!geojson?.features?.length) return;
    this.gcpGeojsonData = geojson;

    const img = new Image();
    img.src = MarkerIcon;
    img.onload = () => {
      if (this.map.hasImage("gcp-marker")) return;
      this.map.addImage("gcp-marker", img);

      this.map.addSource("gcp-points", {
        type: "geojson",
        data: geojson,
      });

      this.map.addLayer({
        id: "gcp-points-layer",
        type: "symbol",
        source: "gcp-points",
        layout: {
          "icon-image": "gcp-marker",
          "icon-size": 0.5,
          "icon-allow-overlap": true,
        },
      });

      // Fit to bounds
      const bounds = new maplibregl.LngLatBounds();
      geojson.features.forEach((f: any) => {
        bounds.extend(f.geometry.coordinates);
      });
      this.map.fitBounds(bounds, { padding: 100, duration: 1000 });
    };
  }

  private loadCog(cogUrl: string) {
    if (!cogUrl) return;

    try {
      maplibregl.addProtocol("cog", cogProtocol);

      this.map.addSource("cog-source", {
        type: "raster",
        url: `cog://${cogUrl}`,
        tileSize: 256,
      });

      this.map.addLayer(
        {
          id: "cog-layer",
          type: "raster",
          source: "cog-source",
        },
        // Insert below gcp-points so markers stay on top
        this.map.getLayer("gcp-points-layer") ? "gcp-points-layer" : undefined,
      );
    } catch (error) {
      console.error("Error loading COG:", error);
    }
  }

  handleGcpDataSelection = () => {
    Store.setSelectedGcpDetails(this.activeGcp);
  };

  private getPopupContent(features: Record<string, any>) {
    return `<div style="display:flex; flex-direction:column; gap:10px;">
              <h5 style="margin:0; padding:4px 0px; border-bottom: 1px solid gray">${features.label}</h5>
              <p style="margin:0;">X: ${features?.x}</p>
              <p style="margin:0;">Y: ${features?.y}</p>
              <p style="margin:0;">Z: ${features?.z}</p>
              <div style="display: flex; justify-content: center;">
                <div style="display: flex; gap: 10px; cursor: pointer; border:1px solid red; border-radius: 12px; padding: 8px 12px; overflow: hidden;"
                    onmouseover="this.style.backgroundColor='#f9d3d3'"
                    onmouseout="this.style.backgroundColor='';"
                    id="upload-button-popup"
                    >
                      <img src=${uploadImage} />
                      <span style="color: red; font-weight: 600;">Image</span>
                </div>
              </div>
            </div>
          `;
  }

  private setupClickHandler() {
    this.popup = new Popup({ closeOnClick: true, offset: 12, closeButton: false });

    // Click on a GCP point feature
    this.map.on("click", "gcp-points-layer", (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties;
      const coords = (e.features[0].geometry as any).coordinates.slice();

      this.showPopup(coords, {
        label: props.label ?? props.id,
        x: props.x,
        y: props.y,
        z: props.z,
      });

      Store.setActiveGcp([props.label ?? props.id, props.x, props.y, props.z]);
    });

    // Click elsewhere closes popup
    this.map.on("click", (e) => {
      const features = this.map.queryRenderedFeatures(e.point, { layers: ["gcp-points-layer"] });
      if (!features.length) {
        this.popup.remove();
        Store.setActiveGcp(null);
      }
    });

    // Pointer cursor on hover
    this.map.on("mouseenter", "gcp-points-layer", () => {
      this.map.getCanvas().style.cursor = "pointer";
    });
    this.map.on("mouseleave", "gcp-points-layer", () => {
      this.map.getCanvas().style.cursor = "";
    });
  }

  private showPopup(coords: [number, number], features: Record<string, any>) {
    const popupContent = this.getPopupContent(features);
    this.popup.setLngLat(coords).setHTML(popupContent).addTo(this.map);

    // Attach upload button handler after popup DOM is ready
    requestAnimationFrame(() => {
      const btn = this.map.getContainer().querySelector("#upload-button-popup");
      btn?.addEventListener("click", this.handleGcpDataSelection);
    });
  }

  // Triggered from table row click via Store event
  private handleGcpSelection(event: Event) {
    const detail = (event as CustomEvent).detail;
    this.activeGcp = detail;

    if (!detail?.[0] || !this.gcpGeojsonData) return;

    const feature = this.gcpGeojsonData.features.find(
      (f: any) => f.properties.id === detail[0] || f.properties.label === detail[0],
    );

    if (feature) {
      const coords = feature.geometry.coordinates;
      this.showPopup(coords, {
        label: detail[0],
        x: detail[1],
        y: detail[2],
        z: detail[3],
      });
      this.map.flyTo({ center: coords, zoom: Math.max(this.map.getZoom(), 12) });
    }
  }

  protected render() {
    return html`
      <div id="map-container">
        <div id="gcp-map-container"></div>
        <div class="layer-switcher">
          <img src=${layerSwitcher} @click=${() => (this.showBaseLayerList = !this.showBaseLayerList)} />
          <div class="base-layer-list" style="display:${this.showBaseLayerList ? "flex" : "none"}">
            <label>
              <input type="radio" name="baseLayerOption" value="osm" checked />
              OSM
            </label>
            <label>
              <input type="radio" name="baseLayerOption" value="satellite" />
              Satellite
            </label>
            <label>
              <input type="radio" name="baseLayerOption" value="topo" />
              Topo
            </label>
            <label>
              <input type="radio" name="baseLayerOption" value="hybrid" />
              Hybrid
            </label>
          </div>
        </div>
      </div>
    `;
  }
}
