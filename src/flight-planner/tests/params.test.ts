import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/core/flightplan";
import { ParamsError, paramsBlocker, parseParams } from "../src/core/params";

describe("parseParams", () => {
  it("round-trips its own defaults", () => {
    expect(parseParams(JSON.parse(JSON.stringify(DEFAULT_PARAMS)))).toEqual(DEFAULT_PARAMS);
  });

  it("fills in everything absent from a partial file", () => {
    expect(parseParams({ droneType: "DJI_AIR_3" })).toEqual({
      ...DEFAULT_PARAMS,
      droneType: "DJI_AIR_3",
    });
  });

  it("rejects an unknown drone by name", () => {
    expect(() => parseParams({ droneType: "PARROT_ANAFI" })).toThrow(/PARROT_ANAFI/);
  });

  it("rejects an out-of-range value and says the range", () => {
    try {
      parseParams({ gsd: 500 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ParamsError);
      expect((error as ParamsError).message).toMatch(/0\.3-20/);
    }
  });

  it("rejects a non-numeric value", () => {
    expect(() => parseParams({ forwardOverlap: "lots" })).toThrow(/not a number/);
  });

  it("accepts string booleans, which is what form-encoded handoffs produce", () => {
    expect(parseParams({ terrainFollow: "false" }).terrainFollow).toBe(false);
    expect(parseParams({ autoRotation: "true" }).autoRotation).toBe(true);
  });

  it("keeps a valid takeoff point", () => {
    expect(parseParams({ takeoffPoint: { lon: 85.3, lat: 27.7 } }).takeoffPoint).toEqual({
      lon: 85.3,
      lat: 27.7,
    });
  });

  it("drops a nonsensical takeoff point rather than failing the whole file", () => {
    expect(parseParams({ takeoffPoint: { lon: 999, lat: 27.7 } }).takeoffPoint).toBeNull();
    expect(parseParams({ takeoffPoint: "somewhere" }).takeoffPoint).toBeNull();
  });

  it("rejects something that is not an object at all", () => {
    expect(() => parseParams("nope")).toThrow(ParamsError);
    expect(() => parseParams(null)).toThrow(ParamsError);
  });

  it("blocks invalid values entered in the form", () => {
    expect(paramsBlocker({ ...DEFAULT_PARAMS, forwardOverlap: 0 })).toMatch(/20-95/);
    expect(paramsBlocker(DEFAULT_PARAMS)).toBeNull();
  });
});
