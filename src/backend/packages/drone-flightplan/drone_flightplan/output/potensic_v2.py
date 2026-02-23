"""JSON waypoint files used in Potensic Atom 2."""

import os
import logging
import zipfile
import json
import time
import tempfile
from typing import Optional
from pathlib import Path

import geojson

log = logging.getLogger(__name__)


def zip_directory(directory_path: str, zip_path: str) -> None:
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


def create_potensic_json(
    featcol: geojson.FeatureCollection,
    outfile: Optional[str] = None,
    default_speed: float = 11.5,
) -> str:
    """
    Generate zipped directory with Potensic waypoints JSON.

    Args:
        featcol: GeoJSON FeatureCollection with waypoint features
        outfile (str): The output zip file. NOTE only the directory will be
            used, with the filename being replaced as needed by Potensic.
            Defaults to current working directory.
        default_speed (float): Default flight speed in m/s.
            NOTE defaults to 11.5 for now.

    Returns:
        str: Path to the generated zip file
    """
    all_features = featcol.get("features", [])
    if not all_features:
        raise ValueError("No features found in feature collection")

    # 1. Create directory based on unix timestamp (in milliseconds)
    timestamp_ms = int(time.time() * 1000)

    # 2. Create global.json with params
    global_json = {
        "finishAction": "RETURN",
        "globalHeight": 0,
        "globalHeightType": 0,
        "isOrder": True,
        "lostAction": "RETURN",
        "speed": default_speed,
    }

    # 3. Create waypoints array from features
    waypoints = []
    for feature in all_features:
        props = feature.get("properties", {})
        coords = feature.get("geometry", {}).get("coordinates", [])

        if len(coords) < 3:
            log.warning(f"Feature missing altitude: {feature}")
            continue

        lng, lat, height = coords[0], coords[1], coords[2]

        # Determine action based on take_photo property
        action = "PHOTO" if props.get("take_photo", False) else "NONE"

        # Gimbal angle / pitch must be an int for Potensic
        # Handle both string and numeric input
        gimbal_angle = props.get("gimbal_angle", -80)
        try:
            gimbal_pitch = int(round(float(gimbal_angle)))
        except (ValueError, TypeError):
            log.warning(
                f"Invalid gimbal_angle value: {gimbal_angle}, using default -80"
            )
            gimbal_pitch = -80

        waypoint = {
            "action": action,
            # We use placeholder filename, as the jpg thumbnails are
            # not mandatory in the waypoint directory
            "fileName": f"point_{timestamp_ms}.jpg",
            "gimbalPitch": gimbal_pitch,
            "gimbalType": "DEFINE",
            "height": height,
            "hoverTime": props.get("hover_time", 0),
            "lat": lat,
            "lng": lng,
            "poiHeight": 0.0,
            "poiLat": 0.0,
            "poiLng": 0.0,
            "poiType": 0,
            "speed": props.get("speed", default_speed),
            "speedType": "DEFINE" if "speed" in props else "GLOBAL",
            "yaw": props.get("heading", 0),
            "yawType": "DEFINE",
            "zoomRatio": 1.0,
            "zoomType": "DEFINE",
        }
        waypoints.append(waypoint)

    # 4. Create mission JSON with waypoints and empty POI array
    # Format: [WAYPOINTS];[POI_LIST]
    mission_json = json.dumps(waypoints) + ";" + json.dumps([])

    # 5. Create zip file using temporary directory
    with tempfile.TemporaryDirectory() as temp_dir:
        # Create mission directory inside temp directory
        mission_dir = Path(temp_dir) / str(timestamp_ms)
        mission_dir.mkdir()

        # Write global.json
        with open(mission_dir / "global.json", "w") as f:
            json.dump(global_json, f, indent=2)

        # Write mission JSON
        with open(mission_dir / f"{timestamp_ms}.json", "w") as f:
            f.write(mission_json)

        # Determine final zip location
        if outfile:
            zip_path = str(Path(outfile).parent / f"{timestamp_ms}.zip")
        else:
            zip_path = str(Path.cwd() / f"{timestamp_ms}.zip")

        # Create zip from temporary directory
        zip_directory(str(mission_dir), zip_path)

    # Temporary directory is automatically cleaned up here

    log.info(f"Created Potensic mission file: {zip_path}")
    return zip_path


if __name__ == "__main__":
    # Test with sample GeoJSON
    sample_features = []
    sample_coords = [
        (20.306835, 51.4583672, 80),
        (20.307056, 51.4583026, 90),
        (20.3065566, 51.4583901, 80),
    ]

    for i, (lng, lat, alt) in enumerate(sample_coords):
        feature = geojson.Feature(
            geometry=geojson.Point((lng, lat, alt)),
            properties={
                "index": i,
                "heading": -90 if i % 2 == 0 else 90,
                "take_photo": i > 0,
                "gimbal_angle": "-80",
                "speed": 5.0,
                "altitude": alt,
            },
        )
        sample_features.append(feature)

    featcol = geojson.FeatureCollection(sample_features)
    output_path = create_potensic_json(featcol)
    print(f"Generated: {output_path}")
