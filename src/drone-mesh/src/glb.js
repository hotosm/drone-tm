import * as THREE from "three";
import { cachedArrayBuffer } from "./modelCache.js";

// Shared GLB "surgery" used by two consumers:
//   - HighResStreamer: strips textures so GLTFLoader decodes ZERO images, then
//     streams tile textures on demand (memory-bounded high-res).
//   - loadCappedBaseMesh (below): builds the always-resident base layer for a
//     SINGLE ODM GLB without the full-resolution up-front decode. ODM's
//     `--gltf` output is one self-contained GLB whose textures decode to
//     several GB of RGBA if handed straight to GLTFLoader (the "white holes /
//     half missing" failure on memory-limited devices). Stripping + capped
//     per-tile decode keeps the peak to one bitmap at a time.
export const WEBP_EXT = "EXT_texture_webp";
export const GLB_MAGIC = 0x46546c67;
export const CHUNK_JSON = 0x4e4f534a;
export const CHUNK_BIN = 0x004e4942;

export function parseGLB(buffer) {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB");
  let off = 12;
  let json = null;
  let bin = null;
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len)));
    } else if (type === CHUNK_BIN) {
      bin = new Uint8Array(buffer, start, len);
    }
    off = start + len; // GLB chunk lengths are already 4-byte aligned
  }
  if (!json || !bin) throw new Error("GLB missing JSON or BIN chunk");
  return { json, bin };
}

// material index -> { bytes, mime } for its base-colour image (webp or jpeg).
export function extractTileImages(json, bin) {
  const byMaterial = {};
  (json.materials || []).forEach((mat, i) => {
    const bct = mat.pbrMetallicRoughness?.baseColorTexture;
    if (!bct) return;
    const tex = json.textures?.[bct.index];
    if (!tex) return;
    let source = tex.source;
    if (tex.extensions?.[WEBP_EXT]) source = tex.extensions[WEBP_EXT].source;
    if (source == null) return;
    const image = json.images?.[source];
    if (!image || image.bufferView == null) return;
    const bv = json.bufferViews[image.bufferView];
    const start = bv.byteOffset || 0;
    byMaterial[i] = {
      bytes: bin.subarray(start, start + bv.byteLength),
      mime: image.mimeType || "image/webp",
    };
  });
  return byMaterial;
}

// Remove every image/texture reference so GLTFLoader decodes no images. Tag
// each material with its index so tiles can be matched back to their image.
export function stripTextures(json) {
  const j = JSON.parse(JSON.stringify(json)); // structure only; bin is separate
  (j.materials || []).forEach((mat, i) => {
    mat.name = `__tile_${i}`;
    if (mat.pbrMetallicRoughness) {
      delete mat.pbrMetallicRoughness.baseColorTexture;
      delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    delete mat.normalTexture;
    delete mat.occlusionTexture;
    delete mat.emissiveTexture;
  });
  delete j.images;
  delete j.textures;
  delete j.samplers;
  const dropWebp = (arr) => (Array.isArray(arr) ? arr.filter((e) => e !== WEBP_EXT) : arr);
  j.extensionsUsed = dropWebp(j.extensionsUsed);
  j.extensionsRequired = dropWebp(j.extensionsRequired);
  return j;
}

export function rebuildGLB(json, bin) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;

  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);

  let p = 12;
  dv.setUint32(p, jsonBytes.length + jsonPad, true);
  dv.setUint32(p + 4, CHUNK_JSON, true);
  p += 8;
  u8.set(jsonBytes, p);
  p += jsonBytes.length;
  for (let i = 0; i < jsonPad; i++) u8[p++] = 0x20; // pad JSON with spaces

  dv.setUint32(p, bin.length + binPad, true);
  dv.setUint32(p + 4, CHUNK_BIN, true);
  p += 8;
  u8.set(bin, p);
  p += bin.length;
  for (let i = 0; i < binPad; i++) u8[p++] = 0x00;

  return out;
}

export function materialIndexOf(mesh, fallback) {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const name = (mat && mat.name) || "";
  const m = /__tile_(\d+)/.exec(name);
  return m ? parseInt(m[1], 10) : fallback;
}

// Decode a compressed tile image, downscaled so its longest side is <= maxSize.
// Peak memory is one full-resolution bitmap at a time (closed immediately after
// the downscale draw), so callers that iterate tiles sequentially never hold
// more than a single decoded image beyond the (small) capped result.
export async function decodeTileImage(bytes, mime, maxSize) {
  const blob = new Blob([bytes], { type: mime || "image/jpeg" });
  const bitmap = await createImageBitmap(blob);
  const longest = Math.max(bitmap.width, bitmap.height);
  const s = longest > maxSize ? maxSize / longest : 1;
  if (s === 1) return bitmap; // already within the cap - upload directly
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * s));
  canvas.height = Math.max(1, Math.round(bitmap.height * s));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

// Build the always-resident base mesh for a single ODM GLB, textures capped at
// `cap` px, WITHOUT the multi-GB up-front decode that GLTFLoader would do on
// the raw file. The geometry is parsed once (textures stripped); each tile's
// image is then decoded sequentially at the cap. The returned object is the
// canonical mesh for selection/labels/collision; the HighResStreamer overlays
// streamed high-res textures on top of it from the SAME (cached) GLB.
export async function loadCappedBaseMesh(gltfLoader, url, cap, onProgress, onStatus) {
  const buffer = await cachedArrayBuffer(url, onProgress, undefined, onStatus);
  const { json, bin } = parseGLB(buffer);
  const imageByMaterial = extractTileImages(json, bin);
  const strippedGLB = rebuildGLB(stripTextures(json), bin);

  const gltf = await new Promise((resolve, reject) => {
    gltfLoader.parse(strippedGLB, "", resolve, reject);
  });
  const object = gltf.scene;

  const meshes = [];
  object.traverse((c) => {
    if (c.isMesh) meshes.push(c);
  });

  // Sequential decode: peak is one bitmap at a time, never the whole atlas.
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    let mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: 0x888888 });
      mesh.material = mat;
    }
    // ODM meshes are single-sided by winding; double-side avoids stray
    // backface holes on noisy photogrammetry geometry.
    mat.side = THREE.DoubleSide;
    const img = imageByMaterial[materialIndexOf(mesh, i)];
    if (!img || !img.bytes) continue;
    try {
      const image = await decodeTileImage(img.bytes, img.mime, cap);
      const tex = new THREE.Texture(image);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false; // glTF UV convention
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      mat.map = tex;
      mat.needsUpdate = true;
    } catch (e) {
      console.warn(`base tile ${i} decode failed, leaving untextured`, e);
    }
  }

  return object;
}
