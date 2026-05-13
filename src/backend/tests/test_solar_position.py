from datetime import datetime, timezone

import pytest

from app.images.solar_position import (
    derive_utc_datetime_from_exif,
    solar_elevation_deg,
)


def test_solar_elevation_summer_noon_low_latitude_is_high():
    # Kathmandu, summer solstice, local noon (UTC+5:45 → 06:15 UTC)
    elevation = solar_elevation_deg(
        27.7172, 85.3240, datetime(2024, 6, 21, 6, 15, tzinfo=timezone.utc)
    )
    # Sun is nearly overhead; comfortably above any reasonable threshold.
    assert elevation > 75.0


def test_solar_elevation_winter_high_latitude_is_low_at_dawn():
    # Reykjavik (lat ~64), winter, just after sunrise -> sun barely above horizon.
    elevation = solar_elevation_deg(
        64.1466, -21.9426, datetime(2024, 12, 21, 11, 30, tzinfo=timezone.utc)
    )
    assert elevation < 10.0


def test_solar_elevation_night_returns_negative():
    # Sydney midnight local (~13:00 UTC) -> sun well below horizon.
    elevation = solar_elevation_deg(
        -33.8688, 151.2093, datetime(2024, 6, 21, 13, 0, tzinfo=timezone.utc)
    )
    assert elevation < 0.0


def test_solar_elevation_requires_timezone_aware_input():
    with pytest.raises(ValueError):
        solar_elevation_deg(0.0, 0.0, datetime(2024, 6, 21, 12, 0))


def test_derive_utc_prefers_combined_gps_datetime():
    exif = {
        "GPSDateTime": "2024:06:15 14:30:22Z",
        # Decoys to confirm priority order.
        "DateTimeOriginal": "2024:06:15 09:30:22",
        "OffsetTimeOriginal": "+00:00",
    }
    dt = derive_utc_datetime_from_exif(exif)
    assert dt == datetime(2024, 6, 15, 14, 30, 22, tzinfo=timezone.utc)


def test_derive_utc_from_split_gps_stamps():
    exif = {
        "GPSDateStamp": "2024:06:15",
        "GPSTimeStamp": "14:30:22",
    }
    dt = derive_utc_datetime_from_exif(exif)
    assert dt == datetime(2024, 6, 15, 14, 30, 22, tzinfo=timezone.utc)


def test_derive_utc_from_local_with_explicit_offset():
    # Local 09:30 in Kathmandu (UTC+5:45) -> 03:45 UTC
    exif = {
        "DateTimeOriginal": "2024:06:15 09:30:00",
        "OffsetTimeOriginal": "+05:45",
    }
    dt = derive_utc_datetime_from_exif(exif)
    assert dt == datetime(2024, 6, 15, 3, 45, 0, tzinfo=timezone.utc)


def test_derive_utc_returns_none_when_offset_missing():
    # No GPS time and no OffsetTimeOriginal -> we refuse to guess.
    exif = {"DateTimeOriginal": "2024:06:15 09:30:00"}
    assert derive_utc_datetime_from_exif(exif) is None


def test_derive_utc_returns_none_on_empty_exif():
    assert derive_utc_datetime_from_exif({}) is None
    assert derive_utc_datetime_from_exif(None) is None  # type: ignore[arg-type]


def test_derive_utc_returns_none_on_unparseable_strings():
    exif = {"GPSDateStamp": "not a date", "GPSTimeStamp": "nor a time"}
    assert derive_utc_datetime_from_exif(exif) is None


def test_low_sun_full_chain_rejects_early_dawn_high_latitude():
    # End-to-end: derive UTC from exif, compute elevation, confirm below
    # the production threshold (10 deg).
    exif = {
        "GPSDateStamp": "2024:12:21",
        "GPSTimeStamp": "11:30:00",  # ~11:30 UTC, Reykjavik
    }
    utc_dt = derive_utc_datetime_from_exif(exif)
    assert utc_dt is not None
    elevation = solar_elevation_deg(64.1466, -21.9426, utc_dt)
    assert elevation < 10.0


def test_low_sun_full_chain_passes_midday_in_tropics():
    exif = {
        "DateTimeOriginal": "2024:06:21 12:00:00",
        "OffsetTimeOriginal": "+05:45",  # Nepal local time
    }
    utc_dt = derive_utc_datetime_from_exif(exif)
    assert utc_dt is not None
    # Midday in Kathmandu in summer: sun is essentially overhead.
    elevation = solar_elevation_deg(27.7172, 85.3240, utc_dt)
    assert elevation > 70.0
