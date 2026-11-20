/**
 * Hourly forecast from Open-Meteo (free, global, no key). A ~10 km model
 * cell cannot see local gusts or storms, so ratings only advise the pilot.
 */

export type Rating = "good" | "marginal" | "poor";

export interface ForecastHour {
  /** Epoch seconds at the start of the hour this row covers. */
  time: number;
  windKmh: number;
  gustKmh: number;
  /** Null where the model gives no rain probability. */
  rainChance: number | null;
}

export interface Forecast {
  lat: number;
  lon: number;
  fetchedAt: number;
  /** Lets hours be shown in the site's time, wherever the browser is. */
  utcOffsetSeconds: number;
  hours: ForecastHour[];
}

/** Same limit as the "wind" checklist item. */
export const WIND_LIMIT_KMH = 20;
const WIND_MARGINAL_KMH = 15;
// Gusts usually run 1.5-2x the sustained wind, so an ordinary day can gust past 20.
const GUST_MARGINAL_KMH = 25;
const GUST_LIMIT_KMH = 30;
// Hourly chances of 20-30% are routine in wet seasons, so lower values stay green.
const RAIN_MARGINAL_PERCENT = 30;
const RAIN_LIMIT_PERCENT = 50;

/** Site hours when the sun is high, so photos have short shadows. */
export const BEST_LIGHT_START_HOUR = 10;
export const BEST_LIGHT_END_HOUR = 14;

/** About one model cell, so a nearby area reuses the stored forecast. */
const SAME_PLACE_DEGREES = 0.1;
const HOUR_SECONDS = 3600;

export function forecastUrl(lat: number, lon: number): string {
  const query = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    hourly: "wind_speed_10m,wind_gusts_10m,precipitation_probability",
    timeformat: "unixtime",
    timezone: "auto",
    forecast_days: "2",
  });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

interface OpenMeteoResponse {
  utc_offset_seconds: number;
  hourly: {
    time: number[];
    wind_speed_10m: number[];
    wind_gusts_10m: number[];
    precipitation_probability: Array<number | null>;
  };
}

export function parseForecast(
  body: OpenMeteoResponse,
  lat: number,
  lon: number,
  fetchedAt = Date.now(),
): Forecast {
  const { hourly } = body;
  const wind = hourly.wind_speed_10m;
  // Open-Meteo gives gusts and rain chance for the hour before each time, so date rows by that hour.
  // Wind is a reading at each time, so a row takes the stronger of its hour's two ends.
  const hours = hourly.time.map((time, i) => ({
    time: time - HOUR_SECONDS,
    windKmh: Math.max(wind[i - 1] ?? wind[i], wind[i]),
    gustKmh: hourly.wind_gusts_10m[i],
    rainChance: hourly.precipitation_probability[i],
  }));
  return { lat, lon, fetchedAt, utcOffsetSeconds: body.utc_offset_seconds, hours };
}

export function rateHour(hour: ForecastHour): Rating {
  const rain = hour.rainChance ?? 0;
  if (hour.windKmh >= WIND_LIMIT_KMH || hour.gustKmh >= GUST_LIMIT_KMH) return "poor";
  if (rain >= RAIN_LIMIT_PERCENT) return "poor";
  if (hour.windKmh >= WIND_MARGINAL_KMH || hour.gustKmh >= GUST_MARGINAL_KMH) return "marginal";
  if (rain >= RAIN_MARGINAL_PERCENT) return "marginal";
  return "good";
}

/** The hour underway onwards. */
export function upcomingHours(forecast: Forecast, count: number, now = Date.now()): ForecastHour[] {
  const startOfHour = now / 1000 - HOUR_SECONDS;
  return forecast.hours.filter((hour) => hour.time > startOfHour).slice(0, count);
}

/** "14:00" in the site's local time. */
export function siteTime(forecast: Forecast, epochSeconds: number): string {
  const shifted = new Date((epochSeconds + forecast.utcOffsetSeconds) * 1000);
  return shifted.toISOString().slice(11, 16);
}

/** Hour of the day at the site, 0-23. */
export function siteHour(epochMs: number, utcOffsetSeconds: number): number {
  return new Date(epochMs + utcOffsetSeconds * 1000).getUTCHours();
}

export function inBestLight(hour: number): boolean {
  return hour >= BEST_LIGHT_START_HOUR && hour < BEST_LIGHT_END_HOUR;
}

/** A stored forecast for this place, or null when it is for somewhere else or unreadable. */
export function readStoredForecast(raw: string | null, lat: number, lon: number): Forecast | null {
  if (!raw) return null;
  let stored: Forecast;
  try {
    stored = JSON.parse(raw) as Forecast;
  } catch {
    return null;
  }
  if (!Array.isArray(stored.hours)) return null;
  const near =
    Math.abs(stored.lat - lat) < SAME_PLACE_DEGREES &&
    Math.abs(stored.lon - lon) < SAME_PLACE_DEGREES;
  return near ? stored : null;
}
