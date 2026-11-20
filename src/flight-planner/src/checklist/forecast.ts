import type { AppState } from "../app";
import {
  BEST_LIGHT_END_HOUR,
  BEST_LIGHT_START_HOUR,
  forecastUrl,
  inBestLight,
  parseForecast,
  rateHour,
  readStoredForecast,
  siteHour,
  siteTime,
  upcomingHours,
  type Forecast,
  type ForecastHour,
  type Rating,
} from "../core/weather";

const STORAGE_KEY = "dtm.forecast";
const REFRESH_AFTER_MS = 30 * 60 * 1000;
const HOURS_SHOWN = 4;

const RATING_CALLOUT: Record<Rating, { variant: string; label: string }> = {
  good: { variant: "success", label: "OK" },
  marginal: { variant: "warning", label: "near the limit" },
  poor: { variant: "danger", label: "over the limit" },
};

function areaCentre(state: AppState): { lat: number; lon: number } | null {
  if (!state.aoi) return null;
  const [west, south, east, north] = state.aoi.bbox;
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

function loadForecast(lat: number, lon: number): Forecast | null {
  try {
    return readStoredForecast(localStorage.getItem(STORAGE_KEY), lat, lon);
  } catch {
    return null;
  }
}

function saveForecast(forecast: Forecast): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(forecast));
  } catch {
    /* Still shown now, and fetched again next time. */
  }
}

function hourRow(forecast: Forecast, hour: Forecast["hours"][number]): string {
  const rain = hour.rainChance === null ? "-" : `${hour.rainChance}%`;
  return `
    <tr data-rating="${rateHour(hour)}">
      <th scope="row">${siteTime(forecast, hour.time)}</th>
      <td>${Math.round(hour.windKmh)}</td>
      <td>${Math.round(hour.gustKmh)}</td>
      <td>${rain}</td>
    </tr>`;
}

const NO_FORECAST = "No weather forecast saved. It loads when you are online.";

function measured(hour: ForecastHour): string {
  return hour.rainChance === null ? "Wind (no rain forecast)" : "Wind and rain";
}

function forecastHtml(forecast: Forecast | null): string {
  const hours = forecast ? upcomingHours(forecast, HOURS_SHOWN) : [];
  if (!forecast || hours.length === 0) return `<p class="muted">${NO_FORECAST}</p>`;
  const current = hours[0];
  const { variant, label } = RATING_CALLOUT[rateHour(current)];
  const updated = new Date(forecast.fetchedAt).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `
    <wa-callout variant="${variant}" appearance="outlined">
      <strong>From ${siteTime(forecast, current.time)}: ${measured(current)} forecast ${label}</strong>
      <table class="forecast-hours">
        <thead><tr><th scope="col">Time</th><th scope="col">Wind km/h</th>
          <th scope="col">Gusts km/h</th><th scope="col">Rain</th></tr></thead>
        <tbody>${hours.map((hour) => hourRow(forecast, hour)).join("")}</tbody>
      </table>
      <p class="muted">
        Forecast only, so check conditions on site. Updated ${updated}.
        Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>.
      </p>
    </wa-callout>`;
}

const BEST_LIGHT = `${BEST_LIGHT_START_HOUR}:00-${BEST_LIGHT_END_HOUR}:00`;

// Without a forecast the device clock stands in for the site's, as the pilot is usually there.
function bestLightNow(forecast: Forecast | null): boolean {
  const offsetSeconds = forecast?.utcOffsetSeconds ?? -new Date().getTimezoneOffset() * 60;
  return inBestLight(siteHour(Date.now(), offsetSeconds));
}

function lightCallout(forecast: Forecast | null): string {
  if (bestLightNow(forecast)) {
    return `
      <wa-callout variant="success" appearance="outlined">
        <strong>Now: within the usual ${BEST_LIGHT} window for shorter shadows.</strong>
      </wa-callout>`;
  }
  return `
    <wa-callout variant="warning" appearance="outlined">
      <strong>Now: outside the usual ${BEST_LIGHT} window for shorter shadows.</strong>
      The map may have dark or blurred patches.
    </wa-callout>`;
}

function dot(variant: string): string {
  return `<span class="forecast-dot" style="background: var(--wa-color-${variant}-fill-loud)"></span>`;
}

// One line for the side panel. The full forecast is in the checklist.
function summaryHtml(forecast: Forecast | null, hasArea: boolean): string {
  const light = bestLightNow(forecast)
    ? `${dot("success")}Shorter shadows now`
    : `${dot("warning")}Longer shadows now`;
  const current = forecast ? upcomingHours(forecast, 1)[0] : undefined;
  if (!hasArea) return light;
  if (!current) return `${light}<br>${NO_FORECAST}`;
  const { variant, label } = RATING_CALLOUT[rateHour(current)];
  return `${dot(variant)}${measured(current)} ${label}<br>${light}`;
}

function fullHtml(forecast: Forecast | null, hasArea: boolean): string {
  return lightCallout(forecast) + (hasArea ? forecastHtml(forecast) : "");
}

/** The full forecast, for the checklist's weather pages. */
export function forecastPanel(): string {
  return `<div class="forecast" data-forecast></div>`;
}

/** A checklist row summarising the forecast, opening the weather checks for the detail. */
export function forecastRow(): string {
  return `
    <div class="download-row">
      <div class="download-meta">
        <strong>Weather and light</strong>
        <span class="muted" data-forecast="summary"></span>
      </div>
      <wa-button data-checklist-open="site" appearance="outlined" size="s">Details</wa-button>
    </div>`;
}

/** Shows the light and saved forecast at once, then refreshes the forecast when online. */
export async function mountForecast(root: HTMLElement, state: AppState): Promise<void> {
  const panel = root.querySelector<HTMLElement>("[data-forecast]");
  if (!panel) return;
  const render = panel.dataset.forecast === "summary" ? summaryHtml : fullHtml;
  const centre = areaCentre(state);
  if (!centre) {
    panel.innerHTML = render(null, false);
    return;
  }
  const stored = loadForecast(centre.lat, centre.lon);
  panel.innerHTML = render(stored, true);
  if (stored && Date.now() - stored.fetchedAt < REFRESH_AFTER_MS) return;
  try {
    const response = await fetch(forecastUrl(centre.lat, centre.lon));
    if (!response.ok) return;
    const forecast = parseForecast(await response.json(), centre.lat, centre.lon);
    saveForecast(forecast);
    panel.innerHTML = render(forecast, true);
  } catch {
    /* Offline: the saved forecast stays, with the time it was updated. */
  }
}
