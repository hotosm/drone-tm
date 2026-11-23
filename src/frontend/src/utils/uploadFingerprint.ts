const EDGE_BYTES = 64 * 1024;

// Must match compute_upload_fingerprint in src/backend/app/images/image_logic.py
// (known answers in src/backend/tests/test_upload_fingerprint.py).
export default async function computeUploadFingerprint(file: Blob): Promise<string> {
  const head = file.slice(0, EDGE_BYTES);
  const tail = file.slice(Math.max(0, file.size - EDGE_BYTES));
  const payload = await new Blob([`${file.size}:`, head, tail]).arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payload));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 32);
}
