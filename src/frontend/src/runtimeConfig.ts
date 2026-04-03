/**
 * Runtime configuration utility
 * Reads from window.__RUNTIME_CONFIG__ (injected at runtime via docker-entrypoint.sh)
 * Falls back to Vite env vars (for local npm dev) or hardcoded defaults
 */
declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      VITE_API_URL?: string;
      VITE_AUTH_PROVIDER?: string;
      VITE_HANKO_URL?: string;
    };
  }
}

export function getRuntimeConfig(
  key: 'VITE_API_URL' | 'VITE_AUTH_PROVIDER' | 'VITE_HANKO_URL',
  fallback: string,
): string {
  // Check runtime config first (injected by docker-entrypoint.sh)
  if (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__?.[key]) {
    return window.__RUNTIME_CONFIG__[key]!;
  }

  // Fall back to Vite env vars (build-time)
  const viteValue = import.meta.env[key];
  if (viteValue) {
    return viteValue;
  }

  // Final fallback
  return fallback;
}
