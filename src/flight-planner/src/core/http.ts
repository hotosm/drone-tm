/** Add the session token only when fetching from the configured API origin. */

type RuntimeGlobal = typeof globalThis & {
  __RUNTIME_CONFIG__?: { VITE_API_URL?: string };
};

function apiOrigin(): string | null {
  const apiUrl =
    (globalThis as RuntimeGlobal).__RUNTIME_CONFIG__?.VITE_API_URL ??
    import.meta.env.VITE_API_URL ??
    "/api";
  try {
    return new URL(apiUrl, location.origin).origin;
  } catch {
    return null;
  }
}

export function isTrustedApiUrl(url: string): boolean {
  const allowed = apiOrigin();
  if (!allowed) return false;
  try {
    return new URL(url, location.origin).origin === allowed;
  } catch {
    return false;
  }
}

export function dtmFetch(url: string): Promise<Response> {
  if (!isTrustedApiUrl(url)) return fetch(url);

  let token: string | null = null;
  try {
    token = localStorage.getItem("token");
  } catch {
    /* Fetch without a token when storage is unavailable. */
  }

  return fetch(url, {
    headers: token ? { "Access-token": token } : {},
    credentials: "include",
  });
}
