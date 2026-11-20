import json
from uuid import UUID

import pytest
from drone_flightplan.calculate_parameters import calculate_parameters
from drone_flightplan.create_flightplan import write_flightplan_file
from drone_flightplan.drone_type import DroneType
from drone_flightplan.output.tricam import (
    add_check_bits,
    build_header,
    create_tricam_plan,
    encode_series_word,
    fingerprint,
)

# Reference header with a known fingerprint
EXAMPLE_UUID = UUID("00112233-4455-6677-8899-aabbccddeeff")
EXAMPLE_SERIES_WORD = 0x90DF47
EXAMPLE_SENSOR_WORD = 0x379024
EXAMPLE_STANZAS = [
    (0x0100, 0x540100, 0, 5),
    (0x0201, 0x001122, 0x334455, 0x667788),
    (0x0302, 0x99AABB, 0xCCDDEE, 0xFF0000),
    (0x0403, EXAMPLE_SERIES_WORD, 0, 0),
    (0x0504, EXAMPLE_SENSOR_WORD, 0, 0),
]
EXAMPLE_FINGERPRINT = 0x4156


def test_check_bits_match_example():
    assert add_check_bits(EXAMPLE_SERIES_WORD & 0xFFFFF, 20, 4) == EXAMPLE_SERIES_WORD
    assert add_check_bits(EXAMPLE_SENSOR_WORD & 0x3FFFF, 18, 6) == EXAMPLE_SENSOR_WORD


def test_fingerprint_matches_example():
    assert fingerprint(EXAMPLE_STANZAS) == EXAMPLE_FINGERPRINT


@pytest.mark.parametrize(
    ("interval_s", "steps"), [(0.5, 0), (1.5, 71), (2.0, 107), (4.0, 250)]
)
def test_series_word_interval(interval_s, steps):
    word = encode_series_word(interval_s)
    assert word & 0xFFFFF == steps
    assert add_check_bits(steps, 20, 4) == word


@pytest.mark.parametrize("interval_s", [0.4, 0.496, 4.005, 4.1])
def test_series_word_rejects_out_of_range_interval(interval_s):
    with pytest.raises(ValueError):
        encode_series_word(interval_s)


def test_header_layout():
    header = build_header(EXAMPLE_UUID, EXAMPLE_SERIES_WORD)

    assert header[0] == (0x0100, 0x540100, 0, 4)
    assert header[1:4] == EXAMPLE_STANZAS[1:4]
    assert header[4] == (0x0604, fingerprint(header[:4]), 0, 0)


@pytest.mark.parametrize("mission_uuid", [UUID(int=0), UUID(int=2**128 - 1)])
def test_header_rejects_reserved_uuid(mission_uuid):
    with pytest.raises(ValueError):
        build_header(mission_uuid, EXAMPLE_SERIES_WORD)


def _placemark(lon, lat, heading):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat, 100]},
        "properties": {"heading": heading, "altitude": 100, "speed": 11.5},
    }


def test_plan_brackets_each_survey_line(tmp_path):
    placemarks = {
        "type": "FeatureCollection",
        "features": [
            _placemark(85.299, 27.699, 0),  # takeoff
            _placemark(85.300, 27.700, 90),
            _placemark(85.303, 27.700, 90),
            _placemark(85.303, 27.701, -90),
            _placemark(85.300, 27.701, -90),
            _placemark(85.299, 27.699, 0),  # return home
        ],
    }

    outfile = create_tricam_plan(placemarks, EXAMPLE_UUID, str(tmp_path / "t.plan"))

    with open(outfile) as f:
        plan = json.load(f)
    items = plan["mission"]["items"]
    assert [item["command"] for item in items] == [
        *[217] * 5,
        22,  # takeoff
        178,  # speed
        16,  # takeoff placemark
        16,
        2500,  # start line 1
        16,
        2501,  # pause
        16,
        2500,  # start line 2
        16,
        532,  # end survey
        16,
        20,  # RTL
    ]
    assert items[0]["params"][:4] == [0x0100, 0x540100, 0, 4]
    assert items[15]["params"][:2] == [4, 0]
    assert plan["mission"]["firmwareType"] == 12  # ArduPilot


def test_plan_skips_single_placemark_rows(tmp_path):
    placemarks = {
        "type": "FeatureCollection",
        "features": [
            _placemark(85.300, 27.700, 90),
            _placemark(85.303, 27.700, 90),
            _placemark(85.303, 27.701, -90),  # single placemark row
            _placemark(85.300, 27.702, 90),
            _placemark(85.303, 27.702, 90),
            _placemark(85.303, 27.703, -90),  # single placemark row
        ],
    }

    outfile = create_tricam_plan(placemarks, EXAMPLE_UUID, str(tmp_path / "t.plan"))

    with open(outfile) as f:
        items = json.load(f)["mission"]["items"]
    assert [item["command"] for item in items[7:]] == [
        16,
        2500,
        16,
        2501,
        16,
        16,
        2500,
        16,
        532,
        16,
        20,
    ]


def test_plan_requires_survey_line(tmp_path):
    placemarks = {"type": "FeatureCollection", "features": [_placemark(85.3, 27.7, 0)]}

    with pytest.raises(ValueError):
        create_tricam_plan(placemarks, EXAMPLE_UUID, str(tmp_path / "t.plan"))


def test_tricam_altitude_for_known_gsd():
    # 100 m AGL with a 5.2 mm lens gives 2.981 cm/px
    params = calculate_parameters(85, 70, agl=0, gsd=2.981, drone_type=DroneType.TRICAM)

    assert params["altitude_above_ground_level"] == pytest.approx(100, abs=0.1)


def test_tricam_ground_speed_is_capped():
    params = calculate_parameters(
        50, 70, agl=100, image_interval=1, drone_type=DroneType.TRICAM
    )

    assert params["ground_speed"] == 15.0


def test_write_flightplan_file_routes_tricam(tmp_path):
    placemarks = {
        "type": "FeatureCollection",
        "features": [_placemark(85.300, 27.700, 90), _placemark(85.303, 27.700, 90)],
    }
    outfile = str(tmp_path / "t.plan")

    write_flightplan_file(placemarks, DroneType.TRICAM, outfile)

    with open(outfile) as f:
        items = json.load(f)["mission"]["items"]
    assert items[0]["params"][:4] == [0x0100, 0x540100, 0, 4]


def test_plan_generates_mission_uuid_by_default(tmp_path):
    placemarks = {
        "type": "FeatureCollection",
        "features": [_placemark(85.300, 27.700, 90), _placemark(85.303, 27.700, 90)],
    }

    uuid_words = []
    for name in ("a.plan", "b.plan"):
        outfile = create_tricam_plan(placemarks, output_file_path=str(tmp_path / name))
        with open(outfile) as f:
            uuid_words.append(json.load(f)["mission"]["items"][1]["params"][1:4])
    assert uuid_words[0] != uuid_words[1]


def test_plan_starts_capture_at_first_line_without_takeoff_placemark(tmp_path):
    placemarks = {
        "type": "FeatureCollection",
        "features": [_placemark(85.300, 27.700, 90), _placemark(85.303, 27.700, 90)],
    }

    outfile = create_tricam_plan(placemarks, EXAMPLE_UUID, str(tmp_path / "t.plan"))

    with open(outfile) as f:
        items = json.load(f)["mission"]["items"]
    assert [item["command"] for item in items[5:]] == [22, 178, 16, 2500, 16, 532, 20]


def test_write_flightplan_file_passes_image_interval(tmp_path):
    placemarks = {
        "type": "FeatureCollection",
        "features": [_placemark(85.300, 27.700, 90), _placemark(85.303, 27.700, 90)],
    }
    outfile = str(tmp_path / "t.plan")

    write_flightplan_file(
        placemarks,
        DroneType.TRICAM,
        outfile,
        image_interval=1,
    )

    with open(outfile) as f:
        series_item = json.load(f)["mission"]["items"][3]
    assert series_item["params"][1] == encode_series_word(1)
