import OlMap from '@openlayers-elements/core/ol-map';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Map as OlMapInstance, Overlay } from 'ol';
import TileLayer from 'ol/layer/WebGLTile.js';
import { OSM, XYZ } from 'ol/source';
import '@openlayers-elements/core/ol-map';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { GeoJSON } from 'ol/format';
import { Style, Icon } from 'ol/style';
import GeoTIFF from 'ol/source/GeoTIFF';
import LayerGroup from 'ol/layer/Group';
import Tile from 'ol/layer/Tile';
import { Store } from '../../store';
import MarkerIcon from '../../assets/markerIcon.png';
import uploadImage from '../../assets/uploadIcon.png';
import layerSwitcher from '../../assets/layers.png';

const cssTextOlPopupWrapper =
  'position: absolute; background-color: white; box-shadow: 0 1px 4px rgba(0,0,0,0.2); padding: 10px; border-radius: 10px; border: 1px solid #cccccc; bottom: 12px; left: -50px; min-width: 280px;';

const cssTextArrowDiv =
  'position: absolute; top: -13px; left: 0px; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 10px solid white; margin-left: -10px;';

@customElement('map-section')
export class MapSection extends LitElement {
  @property({ type: Object }) gcpPointGeojson: String[][] = Store.getGcpGeojson();
  @property({ type: Object }) cogUrl: string = Store.getCogUrl();
  @property({ type: String }) projection: string = Store.getProjection();
  @state() popup: any;
  @state() gcpPointSource: any;
  @state() activeGcp: any;
  @state() showBaseLayerList: boolean = false;

  private map!: OlMapInstance;

  static styles = css`
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
    const mapEl: OlMap = this.renderRoot.querySelector('ol-map#gcp-map')!;
    this.gcpPointGeojson = Store.getGcpGeojson();
    this.projection = Store.getProjection();

    mapEl?.updateComplete?.then(() => {
      this.map = mapEl.map!;

      // **********Base layer section***********
      const osmLayer = new Tile({
        source: new OSM(),
        visible: true,
      });
      osmLayer.set('id', 'osm');

      const satelliteLayer = new Tile({
        source: new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        }),
        visible: false,
      });
      satelliteLayer.set('id', 'satellite');

      const topoLayer = new Tile({
        source: new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        }),
        visible: false,
      });
      topoLayer.set('id', 'topo');

      const hybridLayer = new Tile({
        source: new XYZ({
          url: 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
        }),
        visible: false,
      });
      hybridLayer.set('id', 'hybrid');

      // Create a Layer Group for base layers
      const baseLayerGroup = new LayerGroup({
        layers: [osmLayer, satelliteLayer, topoLayer, hybridLayer],
      });

      // Add the Layer Group to the map
      this.map.addLayer(baseLayerGroup);

      const baseLayerElements = this.shadowRoot?.querySelectorAll(
        '.base-layer-list > label > input[type=radio]'
      ) as NodeListOf<HTMLInputElement>;
      for (let inputElement of baseLayerElements) {
        inputElement.addEventListener('change', () => {
          const baseLayerElement = inputElement.value;
          baseLayerGroup.getLayers().forEach((element) => {
            const baseLayerId = element.get('id');
            element.setVisible(baseLayerElement === baseLayerId);
            this.showBaseLayerList = false;
          });
        });
      }
      // **********Base layer section end***********

      this.loadGcpPoints(this.gcpPointGeojson);

      if (this.cogUrl) {
        this.loadImage(this.cogUrl);
      }

      this.popup = new Overlay({
        element: document.createElement('div'),
      });
      this.popup.getElement().className = 'ol-popup';
      this.popup.getElement().style.cssText = cssTextOlPopupWrapper;

      // Create a new div element for the arrow
      const arrowDiv = document.createElement('div');
      arrowDiv.classList.add('popup-arrow');
      this.popup.getElement().insertAdjacentElement('afterend', arrowDiv);
      arrowDiv.style.cssText = cssTextArrowDiv;
      // end of adding arrow
      this.map.addOverlay(this.popup);
      this.map.on('singleclick', (event) => this.handleMapClick(event));
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this.activeGcp = Store.getActiveGcp();
    document.addEventListener(Store.ACTIVE_GCP_UPDATE, this.handleGcpSelection.bind(this));
  }

  disconnectedCallback() {
    document.removeEventListener(Store.ACTIVE_GCP_UPDATE, this.handleGcpSelection.bind(this));
    const main = this.shadowRoot?.querySelector('#gcp-map')?.shadowRoot;
    const uploadButton = main?.querySelector('#upload-button-popup');
    uploadButton?.removeEventListener('click', this.handleGcpDataSelection);
    super.disconnectedCallback();
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

  // this function is responsible for triggering popup on gcp point click
  private handleMapClick(event: any) {
    const coordinate = event.coordinate;
    const pixel = event.pixel;
    const features = this.map.forEachFeatureAtPixel(pixel, function (feature) {
      return feature.getProperties();
    });

    if (features) {
      this.popup.getElement().innerHTML = this.getPopupContent({
        label: features?.label,
        x: features?.x,
        y: features?.y,
        z: features?.z,
      });
      this.popup.setPosition(coordinate);
      Store.setActiveGcp([features?.label, features?.x, features?.y, features?.z]);

      // add event listener only after the popup is added to DOM
      const main = this.shadowRoot?.querySelector('#gcp-map')?.shadowRoot;
      const uploadButton = main?.querySelector('#upload-button-popup');
      uploadButton?.addEventListener('click', this.handleGcpDataSelection);
      return;
    }
    this.popup.setPosition(undefined);
    Store.setActiveGcp(null);
  }

  // this function is responsive for triggering popup on table row click
  // (on table row click the active gcp will be updated so the event event listener will fire this function with updated value)
  private handleGcpSelection(event: Event) {
    const CustomEvent = event as CustomEvent;
    this.activeGcp = CustomEvent.detail;
    try {
      const feature = this.gcpPointSource?.getFeatureById(CustomEvent.detail?.[0]);
      if (feature) {
        const geometry = feature.getGeometry();
        const coordinates = geometry.getCoordinates();
        this.popup.getElement().innerHTML = this.getPopupContent({
          label: CustomEvent.detail?.[0],
          x: CustomEvent.detail?.[1],
          y: CustomEvent.detail?.[2],
          z: CustomEvent.detail?.[3],
        });
        this.popup.setPosition(coordinates);

        // add event listener only after the popup is added to DOM
        const main = this.shadowRoot?.querySelector('#gcp-map')?.shadowRoot;
        const uploadButton = main?.querySelector('#upload-button-popup');
        uploadButton?.addEventListener('click', this.handleGcpDataSelection);
      }
    } catch (error) {
      console.log('Feature not found');
    }
  }

  private async loadImage(cogUrl: string): Promise<void> {
    if (!cogUrl) {
      alert('Please provide a valid COG URL.');
      return;
    }

    try {
      const geoTiffSource = new GeoTIFF({
        sources: [{ url: cogUrl }],
      });

      const imageLayer = new TileLayer({
        source: geoTiffSource,
      });

      this.map.addLayer(imageLayer);
      console.log('COG loaded successfully.');
      this.map.setView(geoTiffSource.getView());
      this.map.getView().animate({ zoom: 0 });
    } catch (error) {
      console.error('Error loading COG:', error);
      alert('Failed to load the COG file.');
    }
  }

  loadGcpPoints(geojson: any) {
    try {
      // store globally cause it will be used to retrieve feature coordinates by id
      this.gcpPointSource = new VectorSource();
      const format = new GeoJSON();
      // Read features from GeoJSON and add them to the vector source
      geojson.features.forEach((feature: any) => {
        const olFeature = format.readFeature(feature, {
          featureProjection: 'EPSG:3857', // Ensures features are in the correct projection
          dataProjection: this.projection,
        });
        olFeature.setId(feature.properties.id); // set gcp label as id to each feature
        this.gcpPointSource.addFeature(olFeature);
      });

      const gcpPointLayer = new VectorLayer({
        source: this.gcpPointSource,
        style: new Style({
          image: new Icon({
            src: MarkerIcon,
            scale: 0.5,
          }),
        }),
      });

      this.map.addLayer(gcpPointLayer);
      gcpPointLayer.setZIndex(99);
      console.log('Points loaded successfully.');
      this.map.getView().fit(this.gcpPointSource.getExtent(), {
        size: this.map.getSize(),
        padding: [100, 100, 100, 100],
        duration: 1000,
      });
    } catch (error) {
      console.log('Failed to load gcp points');
    }
  }

  protected render() {
    return html`
      <div id="map-container">
        <ol-map id="gcp-map"></ol-map>
        <div class="layer-switcher">
          <img src=${layerSwitcher} @click=${() => (this.showBaseLayerList = !this.showBaseLayerList)} />
          <div class="base-layer-list" style="display:${this.showBaseLayerList ? 'flex' : 'none'}">
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
