import { describe, expect, it } from "vitest";
import { photoFromTags } from "../src/core/photos";
import type { ExpandedTags } from "exifreader";

describe("photoFromTags", () => {
  it("reads DJI position, height and lens", () => {
    const tags = {
      gps: { Latitude: 27.7, Longitude: 85.3 },
      exif: {
        FocalLengthIn35mmFilm: { value: 24 },
        PixelXDimension: { value: 4032 },
        PixelYDimension: { value: 3024 },
        DateTimeOriginal: { description: "2026:11:20 10:00:00" },
      },
      xmp: { RelativeAltitude: { value: "+99.80" }, GimbalYawDegree: { value: "-90.5" } },
    } as unknown as ExpandedTags;

    expect(photoFromTags("DJI_0001.JPG", tags)).toMatchObject({
      lon: 85.3,
      lat: 27.7,
      heightM: 99.8,
      yawDeg: -90.5,
      focal35mm: 24,
      aspect: 4 / 3,
    });
  });

  it("skips a photo without GPS", () => {
    expect(photoFromTags("x.jpg", {} as ExpandedTags)).toBeNull();
  });
});
