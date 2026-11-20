import { describe, expect, it } from "vitest";
import {
  forecastUrl,
  inBestLight,
  parseForecast,
  rateHour,
  readStoredForecast,
  siteHour,
  siteTime,
  upcomingHours,
  type ForecastHour,
} from "../src/core/weather";

const NOON_UTC = Date.UTC(2026, 10, 18, 12) / 1000;
const HOUR = 3600;

const calm: ForecastHour = { time: NOON_UTC, windKmh: 8, gustKmh: 14, rainChance: 0 };

function sampleForecast() {
  const time = [0, 1, 2].map((i) => NOON_UTC + i * HOUR);
  return parseForecast(
    {
      utc_offset_seconds: 3 * HOUR,
      hourly: {
        time,
        wind_speed_10m: [8, 18, 25],
        wind_gusts_10m: [14, 22, 40],
        precipitation_probability: [0, null, 60],
      },
    },
    -1.29,
    36.82,
    NOON_UTC * 1000,
  );
}

describe("rateHour", () => {
  it("is good in calm, dry weather", () => {
    expect(rateHour(calm)).toBe("good");
  });

  it("is poor from the checklist wind limit, which asks for wind below it", () => {
    expect(rateHour({ ...calm, windKmh: 19 })).not.toBe("poor");
    expect(rateHour({ ...calm, windKmh: 20 })).toBe("poor");
  });

  it("is poor in strong gusts, even with light wind", () => {
    expect(rateHour({ ...calm, gustKmh: 35 })).toBe("poor");
  });

  it("is poor when rain is likely", () => {
    expect(rateHour({ ...calm, rainChance: 50 })).toBe("poor");
  });

  it("is good on an ordinary breezy day with a small chance of rain", () => {
    expect(rateHour({ ...calm, windKmh: 11, gustKmh: 21, rainChance: 25 })).toBe("good");
  });

  it("is marginal close to the limits", () => {
    expect(rateHour({ ...calm, windKmh: 17 })).toBe("marginal");
    expect(rateHour({ ...calm, gustKmh: 25 })).toBe("marginal");
    expect(rateHour({ ...calm, rainChance: 30 })).toBe("marginal");
  });

  it("rates on wind alone when the model has no rain probability", () => {
    expect(rateHour({ ...calm, rainChance: null })).toBe("good");
  });
});

describe("forecast", () => {
  it("asks for the hourly values it rates", () => {
    const url = new URL(forecastUrl(-1.29, 36.82));
    expect(url.searchParams.get("hourly")).toBe(
      "wind_speed_10m,wind_gusts_10m,precipitation_probability",
    );
    expect(url.searchParams.get("latitude")).toBe("-1.290");
  });

  it("dates each row by the hour its gusts and rain cover, which ends at the provider's time", () => {
    expect(sampleForecast().hours[0].time).toBe(NOON_UTC - HOUR);
  });

  it("rates each hour on the stronger wind reading at its start or end", () => {
    expect(sampleForecast().hours.map((hour) => hour.windKmh)).toEqual([8, 18, 25]);
    const easing = parseForecast(
      {
        utc_offset_seconds: 0,
        hourly: {
          time: [NOON_UTC, NOON_UTC + HOUR],
          wind_speed_10m: [22, 10],
          wind_gusts_10m: [25, 15],
          precipitation_probability: [0, 0],
        },
      },
      0,
      0,
    );
    expect(easing.hours[1].windKmh).toBe(22);
  });

  it("starts at half past from the row covering the hour underway", () => {
    const now = (NOON_UTC + 30 * 60) * 1000;
    const hours = upcomingHours(sampleForecast(), 6, now);
    expect(hours.map((hour) => hour.windKmh)).toEqual([18, 25]);
  });

  it("shows times in the site's local time", () => {
    const forecast = sampleForecast();
    expect(siteTime(forecast, forecast.hours[0].time)).toBe("14:00");
  });
});

describe("readStoredForecast", () => {
  const raw = JSON.stringify(sampleForecast());

  it("reuses a forecast for a nearby area", () => {
    expect(readStoredForecast(raw, -1.3, 36.85)?.hours).toHaveLength(3);
  });

  it("ignores a forecast for somewhere else", () => {
    expect(readStoredForecast(raw, 27.7, 85.3)).toBeNull();
  });

  it("ignores missing or unreadable storage", () => {
    expect(readStoredForecast(null, -1.29, 36.82)).toBeNull();
    expect(readStoredForecast("{not json", -1.29, 36.82)).toBeNull();
  });
});

describe("best light", () => {
  it("uses the site's hour, not UTC", () => {
    expect(siteHour(NOON_UTC * 1000, 3 * HOUR)).toBe(15);
    expect(siteHour(NOON_UTC * 1000, -5 * HOUR)).toBe(7);
  });

  it("is 10:00 up to, but not including, 14:00", () => {
    expect([9, 10, 13, 14].map(inBestLight)).toEqual([false, true, true, false]);
  });
});
