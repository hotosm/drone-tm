const baseLayersData = {
  osm: {
    source: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        'Map tiles by <a target="_top" rel="noopener" href="https://tile.openstreetmap.org/">OpenStreetMap tile servers</a>, under the <a target="_top" rel="noopener" href="https://operations.osmfoundation.org/policies/tiles/">tile usage policy</a>. Data by <a target="_top" rel="noopener" href="http://openstreetmap.org">OpenStreetMap</a>',
    },
    layer: {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      layout: {
        visibility: 'none',
      },
    },
  },

  'osm-light': {
    source: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution:
        'Map tiles by <a target="_top" rel="noopener" href="https://tile.openstreetmap.org/">OpenStreetMap tile servers</a>, under the <a target="_top" rel="noopener" href="https://operations.osmfoundation.org/policies/tiles/">tile usage policy</a>. Data by <a target="_top" rel="noopener" href="http://openstreetmap.org">OpenStreetMap</a>',
      maxzoom: 18,
    },
    layer: {
      id: 'osm-light',
      type: 'raster',
      source: 'osm-light',
      layout: {
        visibility: 'none',
      },
    },
  },
  satellite: {
    source: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'ArcGIS',
      maxzoom: 18,
    },
    layer: {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      layout: {
        visibility: 'none',
      },
    },
  },
  topo: {
    source: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      maxZoom: 18,
      attribution: 'ArcGIS',
    },
    layer: {
      id: 'topo',
      type: 'raster',
      source: 'topo',
      layout: {
        visibility: 'none',
      },
    },
  },
  hybrid: {
    source: {
      type: 'raster',
      tiles: ['https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'],
      maxZoom: 18,
      attribution: 'ArcGIS',
    },
    layer: {
      id: 'hybrid',
      type: 'raster',
      source: 'hybrid',
      layout: {
        visibility: 'none',
      },
    },
  },
};

export default baseLayersData;
