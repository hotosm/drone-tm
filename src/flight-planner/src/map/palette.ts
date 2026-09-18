// MapLibre paint properties cannot use CSS custom properties directly.

const FALLBACK = {
  photo: "#d43f3f",
  turn: "#9a969b",
  takeoff: "#00883c",
  path: "#344f7b",
  white: "#ffffff",
  static: "#615f66",
} as const;

export type MapColor = keyof typeof FALLBACK;

export function mapColor(name: MapColor): string {
  if (typeof getComputedStyle !== "function") return FALLBACK[name];
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--dtm-map-${name}`)
    .trim();
  return value || FALLBACK[name];
}
