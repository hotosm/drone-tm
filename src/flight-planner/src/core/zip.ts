/**
 * A stored (uncompressed) ZIP writer that takes bytes.
 *
 * The QField plugin's `buildZip` UTF-8 encodes every entry, so it can only
 * carry text - which is why the bundle used to omit the .kmz and the DEM, the
 * two things a pilot most wants to keep. That code is shared with the plugin
 * and has to stay byte-identical, so the web bundle gets its own writer rather
 * than the shared one growing a binary path.
 *
 * No compression: GeoTIFF and KMZ payloads are already compressed, and the
 * text entries are a few KB.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function textEntry(name: string, data: string): ZipEntry {
  return { name, data: new TextEncoder().encode(data) };
}

export function binaryEntry(name: string, data: ArrayBuffer): ZipEntry {
  return { name, data: new Uint8Array(data) };
}

export function buildBinaryZip(entries: ZipEntry[]): ArrayBuffer {
  const parts = entries.map((entry) => ({
    name: new TextEncoder().encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
  }));

  const localSize = parts.reduce((n, p) => n + 30 + p.name.length + p.data.length, 0);
  const centralSize = parts.reduce((n, p) => n + 46 + p.name.length, 0);
  const buffer = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(buffer.buffer);

  let offset = 0;
  const u16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const bytes = (value: Uint8Array) => {
    buffer.set(value, offset);
    offset += value.length;
  };

  const localOffsets: number[] = [];
  for (const part of parts) {
    localOffsets.push(offset);
    u32(0x04034b50);
    u16(20); // version needed
    u16(0); // flags
    u16(0); // method: stored
    u16(0); // mod time
    u16(0); // mod date
    u32(part.crc);
    u32(part.data.length); // compressed size
    u32(part.data.length); // uncompressed size
    u16(part.name.length);
    u16(0); // extra length
    bytes(part.name);
    bytes(part.data);
  }

  const centralStart = offset;
  for (const [index, part] of parts.entries()) {
    u32(0x02014b50);
    u16(20); // version made by
    u16(20); // version needed
    u16(0);
    u16(0); // method: stored
    u16(0);
    u16(0);
    u32(part.crc);
    u32(part.data.length);
    u32(part.data.length);
    u16(part.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number
    u16(0); // internal attrs
    u32(0); // external attrs
    u32(localOffsets[index]);
    bytes(part.name);
  }

  // Captured before the EOCD, whose own bytes advance `offset`.
  const centralBytes = offset - centralStart;

  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(parts.length);
  u16(parts.length);
  u32(centralBytes);
  u32(centralStart);
  u16(0); // comment length

  return buffer.buffer;
}
