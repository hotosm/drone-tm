export class Store {
  private static _gcpData: string[][] = [];
  private static _projection: string = 'EPSG:4326'; // projection its static for now
  private static _cogUrl: string = '';
  private static _activeStep: number = 1;
  private static _gcpPointsGeoJson: Object | null = null;
  private static _selectedGcpDetails: any = null;
  private static _gcpDataWithImageXY: any = {};
  private static _imageList = {};
  private static _rawImageUrl = '';
  private static _activeGcp = []; // it is only simulate  map and table gcp

  //   event for data update
  static readonly GCP_DATA_UPDATE = 'gcp-data-update';
  static readonly COG_URL_UPDATE = 'cog-url-update';
  static readonly PROJECTION_UPDATE = 'projection-url-update';
  static readonly ACTIVE_STEP_UPDATE = 'active-step-update';
  static readonly GCP_POINTS_GEOJSON = 'gcp-points-geojson';
  static readonly SELECTED_GCP_DETAILS_UPDATE = 'selected-gcp-details-update';
  static readonly GCP_DATA_WITH_IMAGE_XY_UPDATE = 'final-gcp-data-with-xy-update';
  static readonly IMAGE_URL_UPDATE = 'image-url-update';
  static readonly ACTIVE_GCP_UPDATE = 'active-gcp-update';

  // ***
  static readonly IMAGE_LIST_UPDATE = 'image-list-update';

  //   Methods to access and update the data
  static getGcpData(): string[][] {
    return this._gcpData;
  }

  static setGcpData(data: string[][]) {
    this._gcpData = data;
    document.dispatchEvent(new CustomEvent(Store.GCP_DATA_UPDATE, { detail: data }));
  }

  static getCogUrl(): string {
    return this._cogUrl;
  }

  static setCogUrl(data: string) {
    this._cogUrl = data;
    document.dispatchEvent(new CustomEvent(Store.COG_URL_UPDATE, { detail: data }));
  }

  static getProjection(): string {
    return this._projection;
  }

  static setProjection(data: string) {
    this._projection = data;
    document.dispatchEvent(new CustomEvent(Store.PROJECTION_UPDATE, { detail: data }));
  }

  static getActiveStep(): number {
    return this._activeStep;
  }

  static setActiveStep(data: number) {
    this._activeStep = data;
    document.dispatchEvent(new CustomEvent(Store.ACTIVE_STEP_UPDATE, { detail: data }));
  }

  static getGcpGeojson(): any {
    return this._gcpPointsGeoJson;
  }

  static setGcpGeojson(data: Object) {
    this._gcpPointsGeoJson = data;
    document.dispatchEvent(new CustomEvent(Store.GCP_POINTS_GEOJSON, { detail: data }));
  }

  static getSelectedGcpDetails(): any {
    return this._selectedGcpDetails;
  }

  static setSelectedGcpDetails(data: any) {
    this._selectedGcpDetails = data;
    document.dispatchEvent(new CustomEvent(Store.SELECTED_GCP_DETAILS_UPDATE, { detail: data }));
  }

  static getGcpDataWithXY(): any {
    return this._gcpDataWithImageXY;
  }

  static setGcpDataWithXY(data: any) {
    this._gcpDataWithImageXY = data;
    document.dispatchEvent(new CustomEvent(Store.GCP_DATA_WITH_IMAGE_XY_UPDATE, { detail: data }));
  }

  static getImageList(): any {
    return this._imageList;
  }

  static setImageList(data: any) {
    this._imageList = data;
    document.dispatchEvent(new CustomEvent(Store.IMAGE_LIST_UPDATE, { detail: data }));
  }

  static getRawImageUrl(): any {
    return this._rawImageUrl;
  }

  static setRawImageUrl(data: any) {
    this._rawImageUrl = data;
    document.dispatchEvent(new CustomEvent(Store.IMAGE_URL_UPDATE, { detail: data }));
  }

  static getActiveGcp(): any {
    return this._activeGcp;
  }

  static setActiveGcp(data: any) {
    this._activeGcp = data;
    document.dispatchEvent(new CustomEvent(Store.ACTIVE_GCP_UPDATE, { detail: data }));
  }

  // to clear all global states
  static clearState() {
    this._gcpData = [];
    this._projection = 'EPSG:4326';
    this._cogUrl = '';
    this._activeStep = 1;
    this._gcpPointsGeoJson = null;
    this._selectedGcpDetails = null;
    this._gcpDataWithImageXY = {};
    this._imageList = {};
    this._rawImageUrl = '';
    this._activeGcp = [];
  }
}
