import pytest

from app.images import image_logic
from app.projects.image_classification import ImageClassifier


def test_extract_gps_from_exif_valid_range_returns_location():
    # We test this helper directly to avoid needing `exiftool` in unit tests.
    loc, gps_error = image_logic._extract_gps_from_exif(  # type: ignore[attr-defined]
        {"GPSLatitude": 27.7, "GPSLongitude": 85.3}
    )
    assert gps_error is None
    assert loc == {"lat": 27.7, "lon": 85.3}


def test_extract_gps_from_exif_out_of_range_returns_error():
    loc, gps_error = image_logic._extract_gps_from_exif(  # type: ignore[attr-defined]
        {"GPSLatitude": 250, "GPSLongitude": 325}
    )
    assert loc is None
    assert gps_error is not None
    assert "Invalid GPS coordinates (out of range)" in gps_error


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("8 deg 17' 42.56\" S", -(8 + 17 / 60.0 + 42.56 / 3600.0)),
        ("115 deg 29' 14.67\" E", (115 + 29 / 60.0 + 14.67 / 3600.0)),
        ("-8.299743916666667", -8.299743916666667),
        ("9.123456", 9.123456),
    ],
)
def test_classifier_parse_gps_strings(value: str, expected: float):
    parsed = ImageClassifier._parse_gps(value)
    assert parsed is not None
    assert parsed == pytest.approx(expected, abs=1e-9)
