"""
Test script: compare Python drone-flightplan output against QField JS pipeline.

This is the Python counterpart to test_compare.mjs. Run both with the same
GeoJSON file and compare output side-by-side. See test_compare.mjs for full
usage instructions.

Usage:
    python3 test_compare.py ../../ban.geojson
    python3 test_compare.py ../../ban2.geojson

Side-by-side diff:
    diff <(node test_compare.mjs ../../ban.geojson) <(python3 test_compare.py ../../ban.geojson)
"""

import sys
import os
import json

# Add drone-flightplan package to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__),
    '..', 'backend', 'packages', 'drone-flightplan'))

from drone_flightplan.waypoints import create_waypoint, calculate_optimal_rotation_angle
from drone_flightplan.calculate_parameters import calculate_parameters
from drone_flightplan.drone_type import DroneType
from drone_flightplan.enums import FlightMode

import pyproj
from shapely.geometry import shape
from shapely.ops import transform

# Load test polygon
if len(sys.argv) < 2:
    print("Usage: python3 test_compare.py <path-to-geojson>", file=sys.stderr)
    print("  e.g. python3 test_compare.py ../../ban.geojson", file=sys.stderr)
    sys.exit(1)
ban_path = os.path.join(os.path.dirname(__file__), sys.argv[1])
with open(ban_path) as f:
    ban_geojson = json.load(f)


def print_stats(label, result_json, params):
    if isinstance(result_json, str):
        geojson_data = json.loads(result_json)
    else:
        geojson_data = result_json

    features = geojson_data.get("features", [])
    point_count = len(features)

    # Unique columns by rounding lon to 6 decimals
    unique_lons = set()
    for f in features:
        lon = f["geometry"]["coordinates"][0]
        unique_lons.add(round(lon, 6))

    print(f"\n=== {label} ===")
    print(f"  Total waypoint count:  {point_count}")
    print(f"  Unique columns (lon):  {len(unique_lons)}")
    print(f"  Forward spacing:       {params['forward_spacing']}")
    print(f"  Side spacing:          {params['side_spacing']}")
    print(f"  Ground speed:          {params['ground_speed']}")
    print(f"  AGL:                   {params['altitude_above_ground_level']}")

    # First 3 and last 3
    print(f"  First 3 points:")
    for i in range(min(3, len(features))):
        c = features[i]["geometry"]["coordinates"]
        p = features[i]["properties"]
        print(f"    [{i}] lon={c[0]:.8f}, lat={c[1]:.8f}, heading={p.get('heading', p.get('angle', 'N/A'))}, take_photo={p.get('take_photo', 'N/A')}")

    print(f"  Last 3 points:")
    for i in range(max(0, len(features) - 3), len(features)):
        c = features[i]["geometry"]["coordinates"]
        p = features[i]["properties"]
        print(f"    [{i}] lon={c[0]:.8f}, lat={c[1]:.8f}, heading={p.get('heading', p.get('angle', 'N/A'))}, take_photo={p.get('take_photo', 'N/A')}")


print("========================================")
print("Python Flightplan Pipeline Comparison")
print("========================================")

# Calculate parameters
params = calculate_parameters(75, 75, None, 3.5, 2, DroneType.DJI_MINI_4_PRO)
print("\nCalculated parameters (GSD=3.5, overlap=75/75):")
print(f"  forward_spacing: {params['forward_spacing']}")
print(f"  side_spacing:    {params['side_spacing']}")
print(f"  ground_speed:    {params['ground_speed']}")
print(f"  AGL:             {params['altitude_above_ground_level']}")

# Calculate auto rotation angle for reporting
polygon = shape(ban_geojson["features"][0]["geometry"])
wgs84 = pyproj.CRS("EPSG:4326")
web_mercator = pyproj.CRS("EPSG:3857")
transformer_to_3857 = pyproj.Transformer.from_crs(wgs84, web_mercator, always_xy=True).transform
polygon_3857 = transform(transformer_to_3857, polygon)
auto_angle = calculate_optimal_rotation_angle(polygon_3857)
print(f"\nAuto-calculated rotation angle: {auto_angle:.4f} degrees")

# Note: create_flightplan.py does `rotation_angle = 360 - rotation_angle` before calling create_waypoint.
# But create_waypoint itself handles auto_rotation independently when rotation_angle is 0 or 360.
# So for auto-rotation, we pass rotation_angle=360 (which is 360-0=360 from create_flightplan).
# Actually, looking more carefully:
#   - create_flightplan: rotation_angle = 360 - rotation_angle (so 0 -> 360)
#   - create_waypoint: if rotation_angle in [0.0, 360.0] and auto_rotation: calculate auto
# The JS core.js does the same: rotationAngle = 360 - rotationAngle, then
#   if autoRotation && (rotationAngle === 0 || rotationAngle === 360): auto-calculate
# So we need to pass rotation_angle=360 (simulating the 360-0 transform) to create_waypoint,
# OR pass rotation_angle=0 and let auto_rotation handle it.
# Actually create_waypoint checks `rotation_angle in [0.0, 360.0]` so passing 360 works fine.

# Run 1: Auto rotation, GSD=3.5, 75% overlap, waylines, no take_off_point
result1 = create_waypoint(
    project_area=ban_geojson,
    agl=None,
    gsd=3.5,
    forward_overlap=75,
    side_overlap=75,
    rotation_angle=360.0,  # 360 - 0 = 360, triggers auto_rotation
    generate_3d=False,
    take_off_point=None,
    mode=FlightMode.WAYLINES,
    drone_type=DroneType.DJI_MINI_4_PRO,
    auto_rotation=True,
)
geojson1 = json.loads(result1["geojson"])
print_stats("Run 1: Auto rotation, GSD=3.5, overlap=75/75, WAYLINES", geojson1, params)
print(f"  Est. flight time (min): {result1['estimated_flight_time_minutes']}")
print(f"  Battery warning:       {result1['battery_warning']}")

# Run 2: Manual rotation=45, GSD=3.5, 75% overlap
# create_flightplan does: rotation_angle = 360 - 45 = 315
result2 = create_waypoint(
    project_area=ban_geojson,
    agl=None,
    gsd=3.5,
    forward_overlap=75,
    side_overlap=75,
    rotation_angle=315.0,  # 360 - 45 = 315
    generate_3d=False,
    take_off_point=None,
    mode=FlightMode.WAYLINES,
    drone_type=DroneType.DJI_MINI_4_PRO,
    auto_rotation=False,
)
geojson2 = json.loads(result2["geojson"])
print_stats("Run 2: Manual rotation=45, GSD=3.5, overlap=75/75, WAYLINES", geojson2, params)
print(f"  Est. flight time (min): {result2['estimated_flight_time_minutes']}")
print(f"  Battery warning:       {result2['battery_warning']}")

# Run 3: Auto rotation, waypoints mode (no simplification)
result3 = create_waypoint(
    project_area=ban_geojson,
    agl=None,
    gsd=3.5,
    forward_overlap=75,
    side_overlap=75,
    rotation_angle=360.0,
    generate_3d=False,
    take_off_point=None,
    mode=FlightMode.WAYPOINTS,
    drone_type=DroneType.DJI_MINI_4_PRO,
    auto_rotation=True,
)
geojson3 = json.loads(result3["geojson"])
print_stats("Run 3: Auto rotation, GSD=3.5, overlap=75/75, WAYPOINTS", geojson3, params)
print(f"  Est. flight time (min): {result3['estimated_flight_time_minutes']}")
print(f"  Battery warning:       {result3['battery_warning']}")
