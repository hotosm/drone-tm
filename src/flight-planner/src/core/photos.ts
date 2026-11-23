import ExifReader, { type ExpandedTags } from "exifreader";

// EXIF and XMP sit in the first segments of a JPEG.
const HEADER_BYTES = 256 * 1024;
const DEFAULT_ASPECT = 4 / 3;

export interface PhotoInfo {
  name: string;
  lon: number;
  lat: number;
  /** Above takeoff, not above the ground below. */
  heightM: number | null;
  yawDeg: number;
  focal35mm: number | null;
  /** Long side over short side. */
  aspect: number;
  takenAt: string;
}

function xmpNumber(tags: ExpandedTags, key: string): number | null {
  const value = Number(tags.xmp?.[key]?.value);
  return Number.isFinite(value) ? value : null;
}

/** Null without GPS. */
export function photoFromTags(name: string, tags: ExpandedTags): PhotoInfo | null {
  const lon = tags.gps?.Longitude;
  const lat = tags.gps?.Latitude;
  if (lon === undefined || lat === undefined) return null;

  const width = Number(tags.exif?.PixelXDimension?.value);
  const height = Number(tags.exif?.PixelYDimension?.value);
  const aspect = width > 0 && height > 0 ? Math.max(width, height) / Math.min(width, height) : 0;

  return {
    name,
    lon,
    lat,
    heightM: xmpNumber(tags, "RelativeAltitude"),
    yawDeg: xmpNumber(tags, "GimbalYawDegree") ?? xmpNumber(tags, "FlightYawDegree") ?? 0,
    focal35mm: Number(tags.exif?.FocalLengthIn35mmFilm?.value) || null,
    aspect: aspect || DEFAULT_ASPECT,
    takenAt: tags.exif?.DateTimeOriginal?.description ?? "",
  };
}

export async function readPhoto(file: File): Promise<PhotoInfo | null> {
  const header = await file.slice(0, HEADER_BYTES).arrayBuffer();
  return photoFromTags(file.name, ExifReader.load(header, { expanded: true }));
}
