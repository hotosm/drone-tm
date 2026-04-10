import { getRuntimeConfig } from "../runtimeConfig";

const API_URL = getRuntimeConfig("VITE_API_URL", "/api");

export async function getPublicPresignedUrl(key: string, expiresHours = 2): Promise<string> {
  const url = new URL(`${API_URL}/public/presigned-url`);
  url.searchParams.set("key", key);
  url.searchParams.set("expires_hours", String(expiresHours));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch presigned URL (${res.status})`);
  }

  const data = (await res.json()) as { url: string };
  return data.url;
}
