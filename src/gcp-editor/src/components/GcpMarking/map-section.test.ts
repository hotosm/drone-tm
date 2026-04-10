import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock maplibre-gl before any imports that use it
// vi.mock is hoisted, so we cannot reference variables declared outside
vi.mock("maplibre-gl", () => {
  class MockLngLatBounds {
    extend = vi.fn().mockReturnThis();
  }

  class MockMap {
    fitBounds = vi.fn();
    flyTo = vi.fn();
    addSource = vi.fn();
    addLayer = vi.fn();
    addImage = vi.fn();
    hasImage = vi.fn().mockReturnValue(false);
    getLayer = vi.fn().mockReturnValue(undefined);
    setLayoutProperty = vi.fn();
    getCanvas = vi.fn().mockReturnValue({ style: {} });
    getContainer = vi.fn().mockReturnValue(document.createElement("div"));
    getZoom = vi.fn().mockReturnValue(10);
    queryRenderedFeatures = vi.fn().mockReturnValue([]);
    remove = vi.fn();
    on = vi.fn();
    constructor() {}
  }

  class MockPopup {
    setLngLat = vi.fn().mockReturnThis();
    setHTML = vi.fn().mockReturnThis();
    addTo = vi.fn().mockReturnThis();
    remove = vi.fn();
    constructor() {}
  }

  return {
    default: { LngLatBounds: MockLngLatBounds, addProtocol: vi.fn() },
    Map: MockMap,
    Popup: MockPopup,
    LngLatBounds: MockLngLatBounds,
    addProtocol: vi.fn(),
  };
});

vi.mock("maplibre-gl-css", () => ({ default: "/* mocked css */" }));
vi.mock("@geomatico/maplibre-cog-protocol", () => ({ cogProtocol: vi.fn() }));

import { Store } from "../../store";
import { MapSection } from "./map-section";
import maplibregl from "maplibre-gl";

// Helper to create a fresh MapSection with a mocked map
function createMapSection(): MapSection {
  const el = document.createElement("map-section") as MapSection;
  return el;
}

function createMockMap() {
  return {
    fitBounds: vi.fn(),
    flyTo: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    addImage: vi.fn(),
    hasImage: vi.fn().mockReturnValue(false),
    getLayer: vi.fn().mockReturnValue(undefined),
    setLayoutProperty: vi.fn(),
    getCanvas: vi.fn().mockReturnValue({ style: {} }),
    getContainer: vi.fn().mockReturnValue(document.createElement("div")),
    getZoom: vi.fn().mockReturnValue(10),
    queryRenderedFeatures: vi.fn().mockReturnValue([]),
    remove: vi.fn(),
    on: vi.fn(),
  };
}

function createMockPopup() {
  return {
    setLngLat: vi.fn().mockReturnThis(),
    setHTML: vi.fn().mockReturnThis(),
    addTo: vi.fn().mockReturnThis(),
    remove: vi.fn(),
  };
}

const SAMPLE_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [85.3, 27.7] },
      properties: { id: "GCP1", label: "GCP1", x: 27.7, y: 85.3, z: 100 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [86.0, 28.0] },
      properties: { id: "GCP2", label: "GCP2", x: 28.0, y: 86.0, z: 200 },
    },
  ],
};

describe("MapSection", () => {
  beforeEach(() => {
    Store.clearState();
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("component registration", () => {
    it("should be defined as a custom element", () => {
      expect(customElements.get("map-section")).toBeDefined();
    });

    it("should be an instance of MapSection", () => {
      const el = createMapSection();
      expect(el).toBeInstanceOf(MapSection);
    });
  });

  describe("Store integration", () => {
    it("should listen for ACTIVE_GCP_UPDATE events on connect", () => {
      const addSpy = vi.spyOn(document, "addEventListener");
      const el = createMapSection();
      document.body.appendChild(el);

      expect(addSpy).toHaveBeenCalledWith(Store.ACTIVE_GCP_UPDATE, expect.any(Function));

      document.body.removeChild(el);
      addSpy.mockRestore();
    });

    it("should remove event listener on disconnect", () => {
      const removeSpy = vi.spyOn(document, "removeEventListener");
      const el = createMapSection();
      document.body.appendChild(el);
      document.body.removeChild(el);

      expect(removeSpy).toHaveBeenCalledWith(Store.ACTIVE_GCP_UPDATE, expect.any(Function));

      removeSpy.mockRestore();
    });

    it("should call map.remove() on disconnect", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      (el as any).map = mockMap;
      document.body.appendChild(el);
      document.body.removeChild(el);

      expect(mockMap.remove).toHaveBeenCalled();
    });

    it("handleGcpDataSelection should set selected GCP details in store", () => {
      const el = createMapSection();
      (el as any).activeGcp = ["GCP1", "1.0", "2.0", "3.0"];

      const spy = vi.spyOn(Store, "setSelectedGcpDetails");
      el.handleGcpDataSelection();

      expect(spy).toHaveBeenCalledWith(["GCP1", "1.0", "2.0", "3.0"]);
      spy.mockRestore();
    });
  });

  describe("getPopupContent", () => {
    it("should generate HTML with GCP details", () => {
      const el = createMapSection();
      const content = (el as any).getPopupContent({
        label: "GCP1",
        x: "27.7",
        y: "85.3",
        z: "100",
      });

      expect(content).toContain("GCP1");
      expect(content).toContain("X: 27.7");
      expect(content).toContain("Y: 85.3");
      expect(content).toContain("Z: 100");
      expect(content).toContain("upload-button-popup");
      expect(content).toContain("Image");
    });
  });

  describe("loadGcpPoints", () => {
    it("should not load if geojson is null", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      (el as any).map = mockMap;

      (el as any).loadGcpPoints(null);
      expect(mockMap.addSource).not.toHaveBeenCalled();
    });

    it("should not load if geojson has no features", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      (el as any).map = mockMap;

      (el as any).loadGcpPoints({ features: [] });
      expect(mockMap.addSource).not.toHaveBeenCalled();
    });

    it("should store geojson data for later lookups", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      (el as any).map = mockMap;

      (el as any).loadGcpPoints(SAMPLE_GEOJSON);
      expect((el as any).gcpGeojsonData).toBe(SAMPLE_GEOJSON);
    });
  });

  describe("loadCog", () => {
    it("should not load if cogUrl is empty", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      (el as any).map = mockMap;

      (el as any).loadCog("");
      expect(maplibregl.addProtocol).not.toHaveBeenCalled();
      expect(mockMap.addSource).not.toHaveBeenCalled();
    });

    it("should register cog protocol and add source/layer", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      (el as any).map = mockMap;

      (el as any).loadCog("https://example.com/cog.tif");

      expect(maplibregl.addProtocol).toHaveBeenCalledWith("cog", expect.any(Function));
      expect(mockMap.addSource).toHaveBeenCalledWith("cog-source", {
        type: "raster",
        url: "cog://https://example.com/cog.tif",
        tileSize: 256,
      });
      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cog-layer", type: "raster", source: "cog-source" }),
        undefined,
      );
    });

    it("should insert COG layer below gcp-points-layer if it exists", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      mockMap.getLayer.mockReturnValueOnce({ id: "gcp-points-layer" });
      (el as any).map = mockMap;

      (el as any).loadCog("https://example.com/cog.tif");

      expect(mockMap.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "cog-layer" }),
        "gcp-points-layer",
      );
    });
  });

  describe("handleGcpSelection (table row click)", () => {
    it("should show popup and fly to feature when GCP is found", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      const mockPopup = createMockPopup();
      (el as any).map = mockMap;
      (el as any).popup = mockPopup;
      (el as any).gcpGeojsonData = SAMPLE_GEOJSON;

      const event = new CustomEvent(Store.ACTIVE_GCP_UPDATE, {
        detail: ["GCP1", "27.7", "85.3", "100"],
      });
      (el as any).handleGcpSelection(event);

      expect(mockPopup.setLngLat).toHaveBeenCalledWith([85.3, 27.7]);
      expect(mockPopup.setHTML).toHaveBeenCalled();
      expect(mockPopup.addTo).toHaveBeenCalled();
      expect(mockMap.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: [85.3, 27.7] }));
    });

    it("should do nothing if detail is null", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      const mockPopup = createMockPopup();
      (el as any).map = mockMap;
      (el as any).popup = mockPopup;
      (el as any).gcpGeojsonData = SAMPLE_GEOJSON;

      const event = new CustomEvent(Store.ACTIVE_GCP_UPDATE, { detail: null });
      (el as any).handleGcpSelection(event);

      expect(mockPopup.setLngLat).not.toHaveBeenCalled();
      expect(mockMap.flyTo).not.toHaveBeenCalled();
    });

    it("should do nothing if feature is not found in geojson", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      const mockPopup = createMockPopup();
      (el as any).map = mockMap;
      (el as any).popup = mockPopup;
      (el as any).gcpGeojsonData = SAMPLE_GEOJSON;

      const event = new CustomEvent(Store.ACTIVE_GCP_UPDATE, {
        detail: ["NONEXISTENT", "0", "0", "0"],
      });
      (el as any).handleGcpSelection(event);

      expect(mockPopup.setLngLat).not.toHaveBeenCalled();
    });

    it("should find feature by properties.id", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      const mockPopup = createMockPopup();
      (el as any).map = mockMap;
      (el as any).popup = mockPopup;
      (el as any).gcpGeojsonData = SAMPLE_GEOJSON;

      const event = new CustomEvent(Store.ACTIVE_GCP_UPDATE, {
        detail: ["GCP2", "28.0", "86.0", "200"],
      });
      (el as any).handleGcpSelection(event);

      expect(mockPopup.setLngLat).toHaveBeenCalledWith([86.0, 28.0]);
    });
  });

  describe("addBaseLayers", () => {
    it("should add satellite, topo, and hybrid sources and layers", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      (el as any).map = mockMap;

      (el as any).addBaseLayers();

      expect(mockMap.addSource).toHaveBeenCalledTimes(3);
      expect(mockMap.addSource).toHaveBeenCalledWith(
        "satellite",
        expect.objectContaining({ type: "raster" }),
      );
      expect(mockMap.addSource).toHaveBeenCalledWith(
        "topo",
        expect.objectContaining({ type: "raster" }),
      );
      expect(mockMap.addSource).toHaveBeenCalledWith(
        "hybrid",
        expect.objectContaining({ type: "raster" }),
      );

      expect(mockMap.addLayer).toHaveBeenCalledTimes(3);
      for (const call of mockMap.addLayer.mock.calls) {
        expect(call[0].layout.visibility).toBe("none");
      }
    });
  });

  describe("setupClickHandler", () => {
    it("should register click and mouse events on the map", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      (el as any).map = mockMap;

      (el as any).setupClickHandler();

      const eventRegistrations = mockMap.on.mock.calls.map((c: any[]) => `${c[0]}:${c[1]}`);
      // click on gcp-points-layer
      expect(eventRegistrations).toContain("click:gcp-points-layer");
      // general click (second arg is a function, not a string)
      expect(
        mockMap.on.mock.calls.some((c: any[]) => c[0] === "click" && typeof c[1] === "function"),
      ).toBe(true);
      // mouseenter/mouseleave for cursor
      expect(eventRegistrations).toContain("mouseenter:gcp-points-layer");
      expect(eventRegistrations).toContain("mouseleave:gcp-points-layer");
    });
  });

  describe("flyTo zoom behavior", () => {
    it("should use at least zoom 12 when current zoom is lower", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      const mockPopup = createMockPopup();
      mockMap.getZoom.mockReturnValue(5);
      (el as any).map = mockMap;
      (el as any).popup = mockPopup;
      (el as any).gcpGeojsonData = SAMPLE_GEOJSON;

      const event = new CustomEvent(Store.ACTIVE_GCP_UPDATE, {
        detail: ["GCP1", "27.7", "85.3", "100"],
      });
      (el as any).handleGcpSelection(event);

      expect(mockMap.flyTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 12 }));
    });

    it("should keep current zoom when already zoomed in past 12", () => {
      const el = createMapSection();
      const mockMap = createMockMap();
      const mockPopup = createMockPopup();
      mockMap.getZoom.mockReturnValue(16);
      (el as any).map = mockMap;
      (el as any).popup = mockPopup;
      (el as any).gcpGeojsonData = SAMPLE_GEOJSON;

      const event = new CustomEvent(Store.ACTIVE_GCP_UPDATE, {
        detail: ["GCP1", "27.7", "85.3", "100"],
      });
      (el as any).handleGcpSelection(event);

      expect(mockMap.flyTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 16 }));
    });
  });
});
