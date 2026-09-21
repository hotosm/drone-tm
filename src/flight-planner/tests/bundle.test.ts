import { describe, expect, it } from "vitest";
import { buildPlanBundle, type OutputFile } from "../src/core/outputs";
import { DEFAULT_PARAMS } from "../src/core/flightplan";
import type { PlanMeta } from "../src/core/storage";

/**
 * The plan bundle is the escape hatch from browser storage, so it has to carry
 * the binary payloads too - the mission file and the DEM. The shared QField
 * zip writer UTF-8 encodes entries and would corrupt both.
 */

const meta: PlanMeta = {
  id: "t",
  name: "Test",
  createdAt: "2026-09-11T00:00:00Z",
  updatedAt: "2026-09-11T00:00:00Z",
};

/** Bytes >= 0x80 are the ones a UTF-8 writer mangles. */
const DEM = new Uint8Array(2048).map((_, i) => (i * 7) % 256);
const KMZ = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x80, 0x00]);

const outputs: OutputFile[] = [
  { name: "plan.geojson", data: '{"a":1}', mime: "application/geo+json", label: "", hint: "" },
  {
    name: "plan.kmz",
    data: KMZ.buffer,
    mime: "application/vnd.google-earth.kmz",
    label: "",
    hint: "",
  },
];

function bundle(): DataView {
  const zip = buildPlanBundle(
    meta,
    { type: "FeatureCollection", features: [] },
    DEFAULT_PARAMS,
    outputs,
    DEM.buffer,
  );
  return new DataView(zip);
}

/** Central directory entries, read the way any unzipper would. */
function readCentralDirectory(view: DataView) {
  const eocd = view.byteLength - 22;
  expect(view.getUint32(eocd, true), "end-of-central-directory signature").toBe(0x06054b50);

  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const start = view.getUint32(eocd + 16, true);
  // The invariant that broke first: the declared size must actually reach the
  // EOCD, or the archive is unreadable.
  expect(start + size).toBe(eocd);

  const entries: Array<{ name: string; size: number; offset: number }> = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true), "central file header signature").toBe(0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    const bytes = new Uint8Array(view.buffer, at + 46, nameLength);
    entries.push({
      name: new TextDecoder().decode(bytes),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength;
  }
  return entries;
}

/** The stored payload sitting behind a local file header. */
function readStored(view: DataView, offset: number, size: number): Uint8Array {
  expect(view.getUint32(offset, true), "local file header signature").toBe(0x04034b50);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  return new Uint8Array(view.buffer, offset + 30 + nameLength + extraLength, size);
}

describe("plan bundle", () => {
  it("is a readable archive", () => {
    expect(readCentralDirectory(bundle()).length).toBeGreaterThan(0);
  });

  it("carries the terrain and the mission file, not just the text", () => {
    const names = readCentralDirectory(bundle()).map((e) => e.name);
    expect(names).toContain("dem.tif");
    expect(names).toContain("plan.kmz");
    expect(names).toEqual(expect.arrayContaining(["meta.json", "aoi.geojson", "params.json"]));
  });

  it("round-trips binary payloads byte for byte", () => {
    const view = bundle();
    const entries = readCentralDirectory(view);

    const dem = entries.find((e) => e.name === "dem.tif")!;
    expect(dem.size).toBe(DEM.byteLength);
    expect([...readStored(view, dem.offset, dem.size)]).toEqual([...DEM]);

    const kmz = entries.find((e) => e.name === "plan.kmz")!;
    expect([...readStored(view, kmz.offset, kmz.size)]).toEqual([...KMZ]);
  });

  it("omits the terrain entry when there is none", () => {
    const zip = buildPlanBundle(meta, {}, DEFAULT_PARAMS, outputs, null);
    const names = readCentralDirectory(new DataView(zip)).map((e) => e.name);
    expect(names).not.toContain("dem.tif");
  });
});
