import { describe, expect, it } from "vitest";
import { geojsonLine, kmzWpml, wpmlLine } from "../src/core/plan-file";
import { photoFromTags } from "../src/core/photos";
import { createKmz } from "../src/core/qfield";
import { buildBinaryZip } from "../src/core/zip";
import type { ExpandedTags } from "exifreader";

const WPML = `<kml><Document><Folder>
  <Placemark><Point><coordinates>85.1,27.1</coordinates></Point></Placemark>
  <Placemark><Point><ns0:coordinates>
    85.2,27.2
  </ns0:coordinates></Point></Placemark>
</Folder></Document></kml>`;

const LINE = [
  [85.1, 27.1],
  [85.2, 27.2],
];

async function deflatedZip(name: string, text: string): Promise<ArrayBuffer> {
  const compressed = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const data = new Uint8Array(await new Response(compressed).arrayBuffer());
  const zip = buildBinaryZip([{ name, data }]);
  const view = new DataView(zip);
  const centralStart = view.getUint32(zip.byteLength - 6, true);
  // Mark the local and central headers as deflated (method 8).
  view.setUint16(8, 8, true);
  view.setUint16(centralStart + 10, 8, true);
  return zip;
}

describe("plan files", () => {
  it("reads placemarks in order, with or without a tag prefix", () => {
    expect(wpmlLine(WPML)).toEqual(LINE);
  });

  it("reads the mission from a DroneTM KMZ", async () => {
    expect(wpmlLine(await kmzWpml(createKmz(WPML)))).toEqual(LINE);
  });

  it("reads the mission from a deflated KMZ", async () => {
    const zip = await deflatedZip("wpmz/waylines.wpml", WPML);
    expect(wpmlLine(await kmzWpml(zip))).toEqual(LINE);
  });

  it("reads waypoint GeoJSON in order", () => {
    const points = {
      type: "FeatureCollection",
      features: LINE.map((coordinates) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [...coordinates, 120] },
        properties: {},
      })),
    };
    expect(geojsonLine(points)).toEqual(LINE);
  });
});

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
