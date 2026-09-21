/** Add the session token only for the configured API origin. */

type RuntimeGlobal = typeof globalThis & {
  __RUNTIME_CONFIG__?: Record<string, string | undefined>;
};

export function runtimeConfig(key: string): string | undefined {
  const runtime = (globalThis as RuntimeGlobal).__RUNTIME_CONFIG__?.[key];
  if (runtime) return runtime;
  const built = (import.meta.env as Record<string, string | undefined>)[key];
  return built || undefined;
}

function apiOrigin(): string | null {
  const apiUrl = runtimeConfig("VITE_API_URL") ?? "/api";
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

export function mainSiteUrl(): string {
  const configured = runtimeConfig("VITE_MAIN_SITE_URL");
  if (configured) return configured.endsWith("/") ? configured : `${configured}/`;

  const root = location.pathname.replace(/\/plan\/?[^/]*$/, "/");
  return new URL(root === location.pathname ? "/" : root, location.origin).toString();
}

export function projectUrl(projectId: string): string {
  return new URL(`projects/${encodeURIComponent(projectId)}`, mainSiteUrl()).toString();
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
