// Reads a flown plan for display only: DJI .kmz/.wpml, or waypoint GeoJSON.

type LonLat = [number, number];

const EOCD_SIGNATURE = 0x06054b50;
const ZIP_STORED = 0;

/** Python's ElementTree may prefix the coordinates tag. */
export function wpmlLine(xml: string): LonLat[] {
  const matches = xml.matchAll(/<(?:\w+:)?coordinates>\s*([-\d.]+)\s*,\s*([-\d.]+)/g);
  return [...matches].map((match) => [Number(match[1]), Number(match[2])]);
}

export function geojsonLine(geojson: unknown): LonLat[] {
  const line: LonLat[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as {
      type?: string;
      features?: unknown[];
      geometry?: unknown;
      coordinates?: unknown;
    };
    if (obj.type === "FeatureCollection") obj.features?.forEach(walk);
    if (obj.type === "Feature") walk(obj.geometry);
    if (obj.type === "Point") line.push((obj.coordinates as number[]).slice(0, 2) as LonLat);
    if (obj.type === "LineString") {
      for (const position of obj.coordinates as number[][]) line.push([position[0], position[1]]);
    }
  };
  walk(geojson);
  return line;
}

/** DroneTM stores KMZ entries uncompressed, DJI apps may deflate them. */
export async function kmzWpml(bytes: ArrayBuffer): Promise<string> {
  const view = new DataView(bytes);
  let eocd = bytes.byteLength - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== EOCD_SIGNATURE) eocd--;
  if (eocd < 0) throw new Error("That .kmz is not a valid zip file.");

  const entryCount = view.getUint16(eocd + 10, true);
  let entry = view.getUint32(eocd + 16, true);
  for (let i = 0; i < entryCount; i++) {
    const method = view.getUint16(entry + 10, true);
    const size = view.getUint32(entry + 20, true);
    const nameLength = view.getUint16(entry + 28, true);
    const localHeader = view.getUint32(entry + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(bytes, entry + 46, nameLength));
    entry += 46 + nameLength + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true);
    if (!name.endsWith(".wpml")) continue;

    const dataStart =
      localHeader +
      30 +
      view.getUint16(localHeader + 26, true) +
      view.getUint16(localHeader + 28, true);
    const data = new Uint8Array(bytes, dataStart, size);
    if (method === ZIP_STORED) return new TextDecoder().decode(data);
    const inflated = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(inflated).text();
  }
  throw new Error("That .kmz has no waylines.wpml mission inside.");
}

export async function readPlanFile(file: File): Promise<LonLat[]> {
  const xml = file.name.toLowerCase().endsWith(".kmz")
    ? await kmzWpml(await file.arrayBuffer())
    : await file.text();
  return wpmlLine(xml);
}
