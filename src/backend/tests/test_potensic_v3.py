import importlib
import json
import zipfile
from pathlib import Path

import geojson
import pytest
from app.waypoints.flightplan_output import get_flightplan_output_config
from drone_flightplan.calculate_parameters import calculate_parameters
from drone_flightplan.drone_type import DRONE_PARAMS, DRONE_SPECS, DroneType
from drone_flightplan.output import potensic_v3

create_flightplan_module = importlib.import_module("drone_flightplan.create_flightplan")


def _atom3_features() -> geojson.FeatureCollection:
    return geojson.FeatureCollection(
        [
            geojson.Feature(
                geometry=geojson.Point((14.3036601, 45.3326784, 50.0)),
                properties={
                    "take_photo": True,
                    "gimbal_angle": "-90",
                    "speed": 5.0,
                },
            ),
            geojson.Feature(
                geometry=geojson.Point((14.3036458, 45.3301753, 50.0)),
                properties={
                    "take_photo": False,
                    "gimbal_angle": -90,
                    "speed": 5.0,
                },
            ),
            geojson.Feature(
                geometry=geojson.Point((14.3029, 45.3287, 50.0)),
                properties={
                    "take_photo": True,
                    "gimbal_angle": -90,
                    "speed": 5.0,
                },
            ),
            geojson.Feature(
                geometry=geojson.Point((14.3021, 45.3271, 50.0)),
                properties={
                    "take_photo": False,
                    "gimbal_angle": -90,
                    "speed": 5.0,
                },
            ),
        ]
    )


def test_atom3_drone_parameters_and_output_config():
    assert DRONE_SPECS[DroneType.POTENSIC_ATOM_3] == {
        "max_battery_life_minutes": {"quoted_value": 40, "tested_value": 18},
        "sensor_height_mm": 7.2,
        "sensor_width_mm": 9.6,
        "equiv_focal_length_mm": 24,
        "image_width_px": 4096,
    }
    assert DRONE_PARAMS[DroneType.POTENSIC_ATOM_3]["OUTPUT_FORMAT"] == (
        "POTENSIC_JSON_V2"
    )
    assert get_flightplan_output_config(DroneType.POTENSIC_ATOM_3) == {
        "suffix": ".zip",
        "media_type": "application/zip",
    }


def test_atom3_output_format_routes_to_v3_serializer(tmp_path, monkeypatch):
    expected_path = str(tmp_path / "atom3.zip")
    captured = {}

    def fake_create_potensic_v3_json(placemarks, outfile):
        captured["placemarks"] = placemarks
        captured["outfile"] = outfile
        return expected_path

    monkeypatch.setattr(
        create_flightplan_module,
        "create_potensic_v3_json",
        fake_create_potensic_v3_json,
    )
    placemarks = {"type": "FeatureCollection", "features": []}

    outpath = create_flightplan_module.write_flightplan_file(
        placemarks,
        DroneType.POTENSIC_ATOM_3,
        str(tmp_path / "flightplan"),
    )

    assert outpath == expected_path
    assert captured == {
        "placemarks": placemarks,
        "outfile": str(tmp_path / "flightplan"),
    }


def test_atom3_ground_speed_uses_existing_default_cap():
    fast_plan = calculate_parameters(
        forward_overlap=0,
        side_overlap=70,
        agl=120,
        image_interval=2,
        drone_type=DroneType.POTENSIC_ATOM_3,
    )
    slow_plan = calculate_parameters(
        forward_overlap=99,
        side_overlap=70,
        agl=10,
        image_interval=2,
        drone_type=DroneType.POTENSIC_ATOM_3,
    )

    assert fast_plan["ground_speed"] == 11.5
    assert slow_plan["ground_speed"] == 0.05


def test_create_atom3_mission_matches_observed_format(tmp_path, monkeypatch):
    timestamp_ms = 1_786_984_375_375
    monkeypatch.setattr(potensic_v3.time, "time", lambda: timestamp_ms / 1000)

    outpath = potensic_v3.create_potensic_v3_json(
        _atom3_features(), outfile=str(tmp_path / "flightplan")
    )

    assert outpath == str(tmp_path / f"{timestamp_ms}.zip")
    with zipfile.ZipFile(outpath) as mission_zip:
        assert set(mission_zip.namelist()) == {
            f"{timestamp_ms}/global.json",
            f"{timestamp_ms}/{timestamp_ms}.json",
        }
        global_json = json.loads(
            mission_zip.read(f"{timestamp_ms}/global.json").decode()
        )
        mission_text = mission_zip.read(f"{timestamp_ms}/{timestamp_ms}.json").decode()

    assert global_json == {
        "finishAction": "RETURN",
        "globalHeight": 0,
        "globalHeightType": 0,
        "isOrder": True,
        "lostAction": "RETURN",
        "speed": 5.0,
    }
    assert not mission_text.endswith("\n")
    assert ";[]" not in mission_text

    waypoints = json.loads(mission_text)
    assert len(waypoints) == 4
    assert waypoints[0] == {
        "action": "PHOTO",
        "gimbalPitch": -90,
        "gimbalType": "DEFINE",
        "height": 50.0,
        "hoverTime": 0,
        "lat": 45.332678,
        "lng": 14.30366,
        "poiHeight": 50.0,
        "poiLat": 0.0,
        "poiLng": 0.0,
        "poiType": 0,
        "speed": 5.0,
        "speedType": "GLOBAL",
        "yaw": 0,
        "yawType": "TO_WAYPOINT",
        "zoomRatio": 1.0,
        "zoomType": "HAND",
    }
    assert waypoints[1]["action"] == "NONE"
    assert all("fileName" not in waypoint for waypoint in waypoints)


def test_atom3_mission_rejects_empty_feature_collection(tmp_path):
    with pytest.raises(ValueError, match="No features found in feature collection"):
        potensic_v3.create_potensic_v3_json(
            geojson.FeatureCollection([]), outfile=str(Path(tmp_path) / "flightplan")
        )


def test_atom3_mission_uses_default_speed_when_waypoints_omit_it(tmp_path, monkeypatch):
    timestamp_ms = 1_786_984_375_375
    monkeypatch.setattr(potensic_v3.time, "time", lambda: timestamp_ms / 1000)
    feature = geojson.Feature(
        geometry=geojson.Point((14.3036601, 45.3326784, 50.0)),
        properties={"take_photo": True},
    )

    outpath = potensic_v3.create_potensic_v3_json(
        geojson.FeatureCollection([feature]),
        outfile=str(Path(tmp_path) / "flightplan"),
    )

    with zipfile.ZipFile(outpath) as mission_zip:
        global_json = json.loads(
            mission_zip.read(f"{timestamp_ms}/global.json").decode()
        )
        waypoints = json.loads(
            mission_zip.read(f"{timestamp_ms}/{timestamp_ms}.json").decode()
        )

    assert global_json["speed"] == 10.0
    assert waypoints[0]["speed"] == 10.0
    assert waypoints[0]["speedType"] == "GLOBAL"
