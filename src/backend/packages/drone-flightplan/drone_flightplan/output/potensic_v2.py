"""JSON waypoint files used in Potensic Atom 2."""

import os
import logging
import zipfile
import json
import time
from typing import Optional
from pathlib import Path

import geojson

log = logging.getLogger(__name__)


def zip_directory(directory_path, zip_path):
    with zipfile.ZipFile(zip_path, "w") as zipf:
        for root, _dirs, files in os.walk(directory_path):
            for file in files:
                zipf.write(
                    os.path.join(root, file),
                    os.path.relpath(
                        os.path.join(root, file), os.path.join(directory_path, "..")
                    ),
                )


def create_zip_file(outdir: str, global_json: dict, mission_json: str):
    """Create zip file with mission data."""
    os.makedirs(outdir, exist_ok=True)

    # Write global.json
    with open(f"{outdir}/global.json", "w") as f:
        json.dump(global_json, f, indent=2)

    # Write mission JSON
    timestamp = os.path.basename(outdir)
    with open(f"{outdir}/{timestamp}.json", "w") as f:
        f.write(mission_json)

    # Create a Zip file containing the contents of the directory
    output_file_name = f"{outdir}.zip"
    zip_directory(outdir, output_file_name)

    return output_file_name


def create_potensic_json(
    featcol: geojson.FeatureCollection,
    outfile: Optional[str] = None,
):
    """
    Generate zipped directory with Potensic waypoints JSON.

    Args:
        featcol: GeoJSON FeatureCollection with waypoint features
        outfile (str): The output zip file. NOTE only the directory will be
            used, with the filename being replaced as needed by Potensic.
            Defaults to current working directory.

    Returns:
        str: Path to the generated zip file
    """
    all_features = featcol.get("features", [])
    if not all_features:
        raise ValueError("No features found in feature collection")

    # 1. Create directory based on unix timestamp (in milliseconds)
    timestamp_ms = int(time.time() * 1000)
    timestamp_directory = str(timestamp_ms)

    # 2. Create global.json with params
    global_json = {
        "finishAction": "RETURN",
        "globalHeight": 0,
        "globalHeightType": 0,
        "isOrder": True,
        "lostAction": "RETURN",
        "speed": 11.5,  # NOTE hardcoded for now
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

        waypoint = {
            "action": action,
            # We use placeholder filename, as the jpg thumbnails are
            # not mandatory in the waypoint directory
            "fileName": f"point_{timestamp_ms}.jpg",
            "gimbalPitch": int(props.get("gimbal_angle", -90)),
            "gimbalType": "DEFINE",
            "height": height,
            "hoverTime": props.get("hover_time", 0),
            "lat": lat,
            "lng": lng,
            "poiHeight": 0.0,
            "poiLat": 0.0,
            "poiLng": 0.0,
            "poiType": 0,
            "speed": props.get("speed", 11.5),  # NOTE hardcoded for now
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

    # 5. Create zip file
    if outfile:
        zip_directory = str(Path(outfile).parent / timestamp_directory)
    else:
        zip_directory = str(Path.cwd() / timestamp_directory)
    zip_path = create_zip_file(zip_directory, global_json, mission_json)

    log.info(f"Created Potensic mission file: {zip_path}")
    return zip_path


if __name__ == "__main__":
    # Test with sample GeoJSON
    sample_features = []
    sample_coords = [
        (20.306835, 51.4583672, 46.1),
        (20.307056, 51.4583026, 46.1),
        (20.3065566, 51.4583901, 46.1),
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
