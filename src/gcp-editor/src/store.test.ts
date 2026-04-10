import { describe, it, expect, beforeEach, vi } from "vitest";
import { Store } from "./store";

describe("Store", () => {
  beforeEach(() => {
    Store.clearState();
  });

  describe("gcpData", () => {
    it("should start with empty array", () => {
      expect(Store.getGcpData()).toEqual([]);
    });

    it("should set and get gcp data", () => {
      const data = [
        ["label", "x", "y", "z"],
        ["GCP1", "1.0", "2.0", "3.0"],
      ];
      Store.setGcpData(data);
      expect(Store.getGcpData()).toEqual(data);
    });

    it("should dispatch event on setGcpData", () => {
      const handler = vi.fn();
      document.addEventListener(Store.GCP_DATA_UPDATE, handler);
      const data = [["GCP1", "1", "2", "3"]];
      Store.setGcpData(data);
      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual(data);
      document.removeEventListener(Store.GCP_DATA_UPDATE, handler);
    });
  });

  describe("activeStep", () => {
    it("should default to 1", () => {
      expect(Store.getActiveStep()).toBe(1);
    });

    it("should set and get active step", () => {
      Store.setActiveStep(2);
      expect(Store.getActiveStep()).toBe(2);
    });

    it("should dispatch event on setActiveStep", () => {
      const handler = vi.fn();
      document.addEventListener(Store.ACTIVE_STEP_UPDATE, handler);
      Store.setActiveStep(3);
      expect(handler).toHaveBeenCalledTimes(1);
      expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe(3);
      document.removeEventListener(Store.ACTIVE_STEP_UPDATE, handler);
    });
  });

  describe("cogUrl", () => {
    it("should default to empty string", () => {
      expect(Store.getCogUrl()).toBe("");
    });

    it("should set and get cog url", () => {
      Store.setCogUrl("https://example.com/cog.tif");
      expect(Store.getCogUrl()).toBe("https://example.com/cog.tif");
    });
  });

  describe("projection", () => {
    it("should default to EPSG:4326", () => {
      expect(Store.getProjection()).toBe("EPSG:4326");
    });

    it("should set and get projection", () => {
      Store.setProjection("EPSG:3857");
      expect(Store.getProjection()).toBe("EPSG:3857");
    });
  });

  describe("selectedGcpDetails", () => {
    it("should default to null", () => {
      expect(Store.getSelectedGcpDetails()).toBeNull();
    });

    it("should set and get selected gcp details", () => {
      const details = ["GCP1", "27.7", "85.3"];
      Store.setSelectedGcpDetails(details);
      expect(Store.getSelectedGcpDetails()).toEqual(details);
    });

    it("should dispatch event on set", () => {
      const handler = vi.fn();
      document.addEventListener(Store.SELECTED_GCP_DETAILS_UPDATE, handler);
      Store.setSelectedGcpDetails(["GCP1"]);
      expect(handler).toHaveBeenCalledTimes(1);
      document.removeEventListener(Store.SELECTED_GCP_DETAILS_UPDATE, handler);
    });
  });

  describe("gcpDataWithXY", () => {
    it("should default to empty object", () => {
      expect(Store.getGcpDataWithXY()).toEqual({});
    });

    it("should set and get gcp data with XY", () => {
      const data = {
        GCP1: {
          "image1.jpg": {
            X: 1,
            Y: 2,
            Z: 3,
            imageX: 100,
            imageY: 200,
            fileName: "image1.jpg",
            gcpLabel: "GCP1",
          },
        },
      };
      Store.setGcpDataWithXY(data);
      expect(Store.getGcpDataWithXY()).toEqual(data);
    });
  });

  describe("imageList", () => {
    it("should default to empty object", () => {
      expect(Store.getImageList()).toEqual({});
    });

    it("should set and get image list", () => {
      const list = { GCP1: ["img1.jpg", "img2.jpg"] };
      Store.setImageList(list);
      expect(Store.getImageList()).toEqual(list);
    });
  });

  describe("rawImageUrl", () => {
    it("should default to empty string", () => {
      expect(Store.getRawImageUrl()).toBe("");
    });

    it("should set and get raw image url", () => {
      Store.setRawImageUrl("https://example.com/images");
      expect(Store.getRawImageUrl()).toBe("https://example.com/images");
    });
  });

  describe("activeGcp", () => {
    it("should default to empty array", () => {
      expect(Store.getActiveGcp()).toEqual([]);
    });

    it("should set and get active gcp", () => {
      Store.setActiveGcp(["GCP1", "GCP2"]);
      expect(Store.getActiveGcp()).toEqual(["GCP1", "GCP2"]);
    });
  });

  describe("gcpGeojson", () => {
    it("should default to null", () => {
      expect(Store.getGcpGeojson()).toBeNull();
    });

    it("should set and get geojson", () => {
      const geojson = { type: "FeatureCollection", features: [] };
      Store.setGcpGeojson(geojson);
      expect(Store.getGcpGeojson()).toEqual(geojson);
    });
  });

  describe("clearState", () => {
    it("should reset all state to defaults", () => {
      Store.setGcpData([["a"]]);
      Store.setActiveStep(3);
      Store.setCogUrl("http://test");
      Store.setProjection("EPSG:3857");
      Store.setSelectedGcpDetails(["GCP1"]);
      Store.setGcpDataWithXY({ test: true });
      Store.setImageList({ test: [] });
      Store.setRawImageUrl("http://images");
      Store.setActiveGcp(["GCP1"]);

      Store.clearState();

      expect(Store.getGcpData()).toEqual([]);
      expect(Store.getActiveStep()).toBe(1);
      expect(Store.getCogUrl()).toBe("");
      expect(Store.getProjection()).toBe("EPSG:4326");
      expect(Store.getSelectedGcpDetails()).toBeNull();
      expect(Store.getGcpDataWithXY()).toEqual({});
      expect(Store.getImageList()).toEqual({});
      expect(Store.getRawImageUrl()).toBe("");
      expect(Store.getActiveGcp()).toEqual([]);
    });
  });

  describe("event constants", () => {
    it("should have unique event names", () => {
      const events = [
        Store.GCP_DATA_UPDATE,
        Store.COG_URL_UPDATE,
        Store.PROJECTION_UPDATE,
        Store.ACTIVE_STEP_UPDATE,
        Store.GCP_POINTS_GEOJSON,
        Store.SELECTED_GCP_DETAILS_UPDATE,
        Store.GCP_DATA_WITH_IMAGE_XY_UPDATE,
        Store.IMAGE_URL_UPDATE,
        Store.ACTIVE_GCP_UPDATE,
        Store.IMAGE_LIST_UPDATE,
      ];
      const uniqueEvents = new Set(events);
      expect(uniqueEvents.size).toBe(events.length);
    });
  });
});
