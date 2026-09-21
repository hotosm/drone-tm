import sys, os, json
sys.path.insert(0, '/sam/repos/drone-tm/src/backend/packages/drone-flightplan')
from drone_flightplan.waypoints import create_waypoint
from drone_flightplan.drone_type import DroneType
from drone_flightplan.enums import FlightMode

doc = json.load(open(sys.argv[1]))
out = {}
for name, rot, auto, mode in [
    ("auto-waylines", None, True, FlightMode.WAYLINES),
    ("rot45-waylines", 315.0, False, FlightMode.WAYLINES),
    ("auto-waypoints", None, True, FlightMode.WAYPOINTS),
]:
    r = create_waypoint(project_area=doc, agl=None, gsd=3.5, forward_overlap=75,
                        side_overlap=75, rotation_angle=rot, generate_3d=False,
                        take_off_point=None, mode=mode,
                        drone_type=DroneType.DJI_MINI_4_PRO, auto_rotation=auto)
    g = json.loads(r["geojson"])
    out[name] = {
        "count": len(g["features"]),
        "time": r["estimated_flight_time_minutes"],
        "battery": r["battery_warning"],
        "pts": [[round(f["geometry"]["coordinates"][0], 7),
                 round(f["geometry"]["coordinates"][1], 7),
                 f["properties"]["heading"],
                 bool(f["properties"]["take_photo"])] for f in g["features"]],
    }
print(json.dumps(out))
