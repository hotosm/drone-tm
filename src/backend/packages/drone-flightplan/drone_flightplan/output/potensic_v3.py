"""JSON waypoint files used by Potensic Atom 3."""

import json
import logging
import os
import tempfile
import time
import zipfile
from pathlib import Path

import geojson

log = logging.getLogger(__name__)


def _zip_directory(directory_path: str, zip_path: str) -> None:
    """Create a zip file from a directory."""
    with zipfile.ZipFile(zip_path, "w") as zipf:
        for root, _dirs, files in os.walk(directory_path):
            for file in files:
                zipf.write(
                    os.path.join(root, file),
                    os.path.relpath(
                        os.path.join(root, file), os.path.join(directory_path, "..")
                    ),
                )


def create_potensic_v3_json(
    featcol: geojson.FeatureCollection,
    outfile: str | None = None,
    default_speed: float = 10.0,
) -> str:
    """Generate a zipped Potensic Atom 3 waypoint mission.

    The Atom 3 uses the same timestamped directory and ``global.json`` shape
    as the Atom 2, but its mission file is a plain JSON array with a slightly
    different waypoint schema.
    """
    all_features = featcol.get("features", [])
    if not all_features:
        raise ValueError("No features found in feature collection")

    timestamp_ms = int(time.time() * 1000)

    # DroneTM applies one calculated speed to every placemark. Use it for the
    # mission-level speed so Atom 3 waypoints can retain the observed GLOBAL
    # speed mode without losing the planned overlap speed.
    mission_speed = default_speed
    for feature in all_features:
        speed = feature.get("properties", {}).get("speed")
        if speed is not None:
            mission_speed = speed
            break

    global_json = {
        "finishAction": "RETURN",
        "globalHeight": 0,
        "globalHeightType": 0,
        "isOrder": True,
        "lostAction": "RETURN",
        "speed": mission_speed,
    }

    waypoints = []
    for feature in all_features:
        props = feature.get("properties", {})
        coords = feature.get("geometry", {}).get("coordinates", [])

        if len(coords) < 3:
            log.warning(f"Feature missing altitude: {feature}")
            continue

        lng, lat, height = coords[0], coords[1], coords[2]
        action = "PHOTO" if props.get("take_photo", False) else "NONE"

        gimbal_angle = props.get("gimbal_angle", -80)
        try:
            gimbal_pitch = round(float(gimbal_angle))
        except (ValueError, TypeError):
            log.warning(
                f"Invalid gimbal_angle value: {gimbal_angle}, using default -80"
            )
            gimbal_pitch = -80

        waypoint_speed = props.get("speed", mission_speed)
        waypoint = {
            "action": action,
            "gimbalPitch": gimbal_pitch,
            "gimbalType": "DEFINE",
            "height": height,
            "hoverTime": props.get("hover_time", 0),
            "lat": lat,
            "lng": lng,
            "poiHeight": height,
            "poiLat": 0.0,
            "poiLng": 0.0,
            "poiType": 0,
            "speed": waypoint_speed,
            "speedType": ("GLOBAL" if waypoint_speed == mission_speed else "DEFINE"),
            "yaw": 0,
            "yawType": "TO_WAYPOINT",
            "zoomRatio": 1.0,
            "zoomType": "HAND",
        }
        waypoints.append(waypoint)

    mission_json = json.dumps(waypoints)

    with tempfile.TemporaryDirectory() as temp_dir:
        mission_dir = Path(temp_dir) / str(timestamp_ms)
        mission_dir.mkdir()

        with open(mission_dir / "global.json", "w") as f:
            json.dump(global_json, f, indent=2)

        with open(mission_dir / f"{timestamp_ms}.json", "w") as f:
            f.write(mission_json)

        if outfile:
            zip_path = str(Path(outfile).parent / f"{timestamp_ms}.zip")
        else:
            zip_path = str(Path.cwd() / f"{timestamp_ms}.zip")

        _zip_directory(str(mission_dir), zip_path)

    log.info(f"Created Potensic Atom 3 mission file: {zip_path}")
    return zip_path
