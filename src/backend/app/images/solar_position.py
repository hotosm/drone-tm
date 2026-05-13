"""Solar position helpers used to flag imagery captured at low sun angles.

The math here is the simplified NOAA Solar Position Algorithm (Spencer
truncation) - accurate to ~0.5 degrees, which is plenty for "is the sun
too low to fly?" decisions.  Pure-Python (stdlib only) so we don't pull
in another dependency.

We do NOT estimate the timezone from longitude; if the EXIF block doesn't
contain an explicit UTC reference (GPSDateTime / GPSDateStamp+GPSTimeStamp,
or DateTimeOriginal paired with OffsetTimeOriginal) we return None and the
caller skips the check entirely.  False negatives are preferred to false
positives - users can always re-flag images manually, but silent rejection
of well-lit imagery from a misread timezone would be much worse.
"""

import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


def solar_elevation_deg(lat_deg: float, lon_deg: float, utc_dt: datetime) -> float:
    """Return the sun's elevation angle (degrees above horizon) for a point.

    Args:
        lat_deg: Latitude in decimal degrees, north positive.
        lon_deg: Longitude in decimal degrees, east positive.
        utc_dt: Timezone-aware UTC datetime of observation.

    Returns:
        Elevation in degrees. Positive = above horizon, negative = below.
    """
    if utc_dt.tzinfo is None:
        raise ValueError("utc_dt must be timezone-aware")
    utc_dt = utc_dt.astimezone(timezone.utc)

    # Fractional year in radians (Spencer 1971).  Includes the hour-of-day
    # term so the answer is continuous across midnight.
    day_of_year = utc_dt.timetuple().tm_yday
    hour_frac = utc_dt.hour + utc_dt.minute / 60 + utc_dt.second / 3600
    gamma = (2 * math.pi / 365) * (day_of_year - 1 + (hour_frac - 12) / 24)

    # Equation of time in minutes
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(gamma)
        - 0.032077 * math.sin(gamma)
        - 0.014615 * math.cos(2 * gamma)
        - 0.040849 * math.sin(2 * gamma)
    )

    # Solar declination in radians
    decl = (
        0.006918
        - 0.399912 * math.cos(gamma)
        + 0.070257 * math.sin(gamma)
        - 0.006758 * math.cos(2 * gamma)
        + 0.000907 * math.sin(2 * gamma)
        - 0.002697 * math.cos(3 * gamma)
        + 0.00148 * math.sin(3 * gamma)
    )

    # True solar time in minutes (4 min per degree of longitude, plus EoT)
    tst = hour_frac * 60 + eqtime + 4 * lon_deg
    # Solar hour angle in degrees
    ha_deg = (tst / 4) - 180
    ha_rad = math.radians(ha_deg)

    lat_rad = math.radians(lat_deg)
    cos_zenith = math.sin(lat_rad) * math.sin(decl) + math.cos(lat_rad) * math.cos(
        decl
    ) * math.cos(ha_rad)
    cos_zenith = max(-1.0, min(1.0, cos_zenith))
    zenith_rad = math.acos(cos_zenith)
    return 90.0 - math.degrees(zenith_rad)


_DATETIME_FORMATS = (
    "%Y:%m:%d %H:%M:%S",
    "%Y-%m-%d %H:%M:%S",
    "%Y:%m:%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
)


def _parse_naive_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    s = value.strip()
    # Strip a trailing fractional seconds + optional 'Z' or offset before
    # matching - we re-apply the offset separately.
    s = re.sub(r"\.\d+", "", s)
    s = s.rstrip("Z").strip()
    s = re.split(r"[+\-]\d{2}:?\d{2}$", s)[0].strip()
    for fmt in _DATETIME_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _parse_offset(value: Any) -> Optional[timedelta]:
    """Parse "+HH:MM" / "-HHMM" / "Z" / "+05:30" style offsets."""
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    if s.upper() == "Z":
        return timedelta(0)
    m = re.match(r"^([+\-])(\d{2}):?(\d{2})$", s)
    if not m:
        return None
    sign = 1 if m.group(1) == "+" else -1
    hours = int(m.group(2))
    minutes = int(m.group(3))
    return sign * timedelta(hours=hours, minutes=minutes)


def _split_gps_datetime(value: Any) -> Optional[datetime]:
    """Parse a combined GPSDateTime like "2024:06:15 14:30:22Z" (always UTC)."""
    naive = _parse_naive_datetime(value)
    if naive is None:
        return None
    return naive.replace(tzinfo=timezone.utc)


def _combine_gps_date_time(date_value: Any, time_value: Any) -> Optional[datetime]:
    """Combine separate GPSDateStamp ("2024:06:15") and GPSTimeStamp
    ("14:30:22" or "14:30:22.123") fields. GPS timestamps are always UTC."""
    if not isinstance(date_value, str) or not isinstance(time_value, str):
        return None
    combined = f"{date_value.strip()} {time_value.strip()}"
    naive = _parse_naive_datetime(combined)
    if naive is None:
        return None
    return naive.replace(tzinfo=timezone.utc)


def derive_utc_datetime_from_exif(exif: dict) -> Optional[datetime]:
    """Return a confidence-checked UTC datetime for the capture, or None.

    Tries, in order:
      1. GPSDateTime (always UTC)
      2. GPSDateStamp + GPSTimeStamp (always UTC)
      3. DateTimeOriginal + OffsetTimeOriginal (local time with explicit offset)

    Returns None - and the caller MUST skip any sun-elevation check - if
    none of these combinations are present.  We deliberately do not guess
    the timezone from longitude: that would invite false-positive rejections
    near timezone borders or when the camera clock is misset.
    """
    if not exif:
        return None

    # 1. Combined GPSDateTime
    dt = _split_gps_datetime(exif.get("GPSDateTime"))
    if dt is not None:
        return dt

    # 2. Split GPS date + time
    dt = _combine_gps_date_time(exif.get("GPSDateStamp"), exif.get("GPSTimeStamp"))
    if dt is not None:
        return dt

    # 3. DateTimeOriginal + OffsetTimeOriginal
    local = _parse_naive_datetime(exif.get("DateTimeOriginal"))
    offset = _parse_offset(exif.get("OffsetTimeOriginal"))
    if local is not None and offset is not None:
        return (local - offset).replace(tzinfo=timezone.utc)

    return None
