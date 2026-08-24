"""Shared readers for EXIF values that more than one check needs.

DJI writes the same figure under different tags depending on model and
firmware, and some of it only inside a JSON blob in UserComment. Resolving
that in one place keeps the checks from disagreeing about what a frame says.
"""

import json
from typing import Any

from loguru import logger as log


def pitch_columns_sql(prefix: str = "") -> str:
    """The columns pitch_from_row reads, projected from an image row."""
    p = f"{prefix}." if prefix else ""
    return (
        f"{p}exif->>'GimbalPitchDegree' AS gimbal_pitch_raw, "
        f"{p}exif->>'pitch' AS pitch_raw, "
        f"{p}exif->>'UserComment' AS user_comment"
    )


def to_float(value: Any) -> float | None:
    """Best-effort float from an EXIF value, None where it will not parse."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def drone_metadata(exif: dict[str, Any]) -> dict[str, Any]:
    """Drone telemetry from the JSON blob in UserComment, empty when absent."""
    user_comment = exif.get("UserComment")
    if not isinstance(user_comment, str):
        return {}
    try:
        parsed = json.loads(user_comment)
    except (json.JSONDecodeError, TypeError):
        log.debug("Could not parse UserComment as JSON")
        return {}
    return parsed if isinstance(parsed, dict) else {}


def resolve_gimbal_pitch(data: dict[str, Any]) -> Any:
    """Camera pitch from EXIF merged with drone metadata, still unparsed.

    GimbalPitchDegree is preferred but 0.0 is a real value (camera level with
    the horizon), so presence is tested rather than truthiness.
    FlightPitchDegree is deliberately ignored: that is aircraft attitude.
    """
    for key in ("GimbalPitchDegree", "pitch"):
        value = data.get(key)
        if value is not None and value != "":
            return value
    return None


def pitch_from_row(row: dict) -> float | None:
    """Camera pitch for a row selected with pitch_columns_sql."""
    data = {
        "GimbalPitchDegree": row.get("gimbal_pitch_raw"),
        "pitch": row.get("pitch_raw"),
    }
    data.update(drone_metadata({"UserComment": row.get("user_comment")}))
    return to_float(resolve_gimbal_pitch(data))
