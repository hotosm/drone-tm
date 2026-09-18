type RuntimeConfigKey =
  | "VITE_API_URL"
  | "VITE_AUTH_PROVIDER"
  | "VITE_HANKO_URL"
  | "VITE_DRONE_MESH_URL"
  | "VITE_FLIGHT_PLANNER_URL";

type RuntimeConfig = Partial<Record<RuntimeConfigKey, string>>;
type RuntimeWindow = Window & { __RUNTIME_CONFIG__?: RuntimeConfig };

export function getRuntimeConfig(key: RuntimeConfigKey, fallback: string): string {
  let runtimeValue: string | undefined;
  if (typeof window !== "undefined") {
    // eslint-disable-next-line no-underscore-dangle -- injected by the container entrypoint
    runtimeValue = (window as RuntimeWindow).__RUNTIME_CONFIG__?.[key];
  }
  if (runtimeValue) return runtimeValue;

  const viteValue = import.meta.env[key];
  if (viteValue) return viteValue;

  return fallback;
}
