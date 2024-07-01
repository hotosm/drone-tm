const baseLayersData = {
  osm: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution:
          'Map tiles by <a target="_top" rel="noopener" href="https://tile.openstreetmap.org/">OpenStreetMap tile servers</a>, under the <a target="_top" rel="noopener" href="https://operations.osmfoundation.org/policies/tiles/">tile usage policy</a>. Data by <a target="_top" rel="noopener" href="http://openstreetmap.org">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: 'osm',
        type: 'raster',
        source: 'osm',
      },
    ],
  },
  'osm-light': {
    version: 8,
    sources: {
      'osm-light': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '',
        maxzoom: 18,
      },
    },
    layers: [
      {
        id: 'osm-light',
        type: 'raster',
        source: 'osm-light',
      },
    ],
  },
  satellite: {
    version: 8,
    sources: {
      satellite: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: '',
        maxzoom: 18,
      },
    },
    layers: [
      {
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
      },
    ],
  },
  topo: {
    version: 8,
    sources: {
      topo: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        ],
        maxZoom: 18,
      },
    },
    layers: [
      {
        id: 'topo',
        type: 'raster',
        source: 'topo',
      },
    ],
  },
  hybrid: {
    version: 8,
    sources: {
      hybrid: {
        type: 'raster',
        tiles: ['https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'],
        maxZoom: 18,
      },
    },
    layers: [
      {
        id: 'hybrid',
        type: 'raster',
        source: 'hybrid',
      },
    ],
  },
};

export default baseLayersData;
