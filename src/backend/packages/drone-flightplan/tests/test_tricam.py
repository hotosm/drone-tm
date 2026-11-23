import json
from uuid import UUID

from drone_flightplan.output.tricam import (
    PHOTO_INTERVAL_S,
    add_check_bits,
    build_header,
    create_tricam_plan,
    encode_calibration_word,
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

# Config, Start, yaw, hover, Pause, each Tri-Cam command followed by a delay
CALIBRATION = [531, 112, 2500, 112, 115, 19, 2501, 112]


def test_check_bits_match_example():
    assert add_check_bits(EXAMPLE_SERIES_WORD & 0xFFFFF, 20, 4) == EXAMPLE_SERIES_WORD
    assert add_check_bits(EXAMPLE_SENSOR_WORD & 0x3FFFF, 18, 6) == EXAMPLE_SENSOR_WORD


def test_fingerprint_matches_example():
    assert fingerprint(EXAMPLE_STANZAS) == EXAMPLE_FINGERPRINT


def test_header_layout():
    header = build_header(EXAMPLE_UUID, EXAMPLE_SERIES_WORD)

    assert header[0] == (0x0100, 0x540100, 0, 4)
    assert header[1:4] == EXAMPLE_STANZAS[1:4]
    assert header[4] == (0x0604, fingerprint(header[:4]), 0, 0)


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
        *CALIBRATION,
        2500,  # start line 1
        112,
        16,
        2501,  # pause
        112,
        16,
        2500,  # start line 2
        112,
        16,
        532,  # end survey
        112,
        16,
        20,  # RTL
    ]
    assert items[0]["params"][:4] == [0x0100, 0x540100, 0, 4]
    end_survey = next(item for item in items if item["command"] == 532)
    assert end_survey["params"][:2] == [4, 0]
    delays = [item["params"][0] for item in items if item["command"] == 112]
    assert delays == [0.1] * len(delays)
    assert plan["mission"]["firmwareType"] == 12  # ArduPilot


def test_calibration_word_selects_pre_survey_aec():
    word = encode_calibration_word(PHOTO_INTERVAL_S)

    assert word == add_check_bits(word & 0xFFFFF, 20, 4)
    assert word & 0xFF == encode_series_word(PHOTO_INTERVAL_S) & 0xFF  # interval
    assert (word >> 13) & 0b11 == 3  # pre-survey AEC
    assert (word >> 16) & 0xF == 5  # frames
