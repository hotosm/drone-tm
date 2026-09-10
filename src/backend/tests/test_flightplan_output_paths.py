import os
import tempfile
import zipfile

import geojson
import pytest
from app.waypoints.flightplan_output import build_flightplan_download_response
from drone_flightplan.drone_type import DroneType
from drone_flightplan.output.dji import create_wpml
from drone_flightplan.output.litchi import create_litchi_csv
from drone_flightplan.output.mavlink import create_mavlink_plan
from drone_flightplan.output.output_paths import resolve_output_path
from drone_flightplan.output.qgroundcontrol import create_qgroundcontrol_plan

WRITERS = [
    create_wpml,
    create_litchi_csv,
    create_mavlink_plan,
    create_qgroundcontrol_plan,
]


@pytest.fixture
def placemarks():
    """A minimal three waypoint mission, valid for every output format."""
    coordinates = [
        (20.306835, 51.4583672, 80),
        (20.307056, 51.4583026, 90),
        (20.3065566, 51.4583901, 80),
    ]
    return geojson.FeatureCollection(
        [
            geojson.Feature(
                geometry=geojson.Point(coordinate),
                properties={
                    "index": index,
                    "altitude": coordinate[2],
                    "elevation": 0,
                    "speed": 10.0,
                    "gimbal_angle": -90,
                    "heading": 0,
                    "take_photo": True,
                },
            )
            for index, coordinate in enumerate(coordinates)
        ]
    )


@pytest.fixture
def isolated_tmpdir(monkeypatch, tmp_path):
    """Point the tempfile module at an empty dir, so leftovers are visible."""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    return tmp_path


@pytest.mark.parametrize("writer", WRITERS)
def test_writer_without_output_path_uses_managed_tempfile(
    writer, placemarks, isolated_tmpdir
):
    outpath = writer(placemarks)

    assert os.path.isfile(outpath)
    assert os.path.getsize(outpath) > 0
    # Written under the temp dir, not to a hardcoded /tmp/mission.* path
    assert os.path.dirname(outpath) == str(isolated_tmpdir)


@pytest.mark.parametrize("writer", WRITERS)
def test_writer_generates_a_unique_path_per_call(writer, placemarks, isolated_tmpdir):
    # Concurrent missions used to overwrite each other's output file
    assert writer(placemarks) != writer(placemarks)


@pytest.mark.parametrize("writer", WRITERS)
def test_writer_honours_explicit_output_path(writer, placemarks, tmp_path):
    target = str(tmp_path / "nested" / "mission")

    outpath = writer(placemarks, target)

    assert outpath == target
    assert os.path.isfile(outpath)


def test_dji_leaves_no_scratch_files_behind(placemarks, isolated_tmpdir):
    kmz_path = create_wpml(placemarks)

    # The waylines.wpml / wpmz tree is scratch space and must not survive
    assert [entry.name for entry in isolated_tmpdir.iterdir()] == [
        os.path.basename(kmz_path)
    ]
    assert zipfile.ZipFile(kmz_path).namelist() == ["wpmz/waylines.wpml"]


def test_dji_still_accepts_a_directory_as_output_path(placemarks, tmp_path):
    outpath = create_wpml(placemarks, str(tmp_path))

    assert outpath == str(tmp_path / "output.kmz")
    assert zipfile.ZipFile(outpath).namelist() == ["wpmz/waylines.wpml"]


def test_resolve_output_path_creates_missing_parent_directories(tmp_path):
    target = str(tmp_path / "does" / "not" / "exist" / "mission.csv")

    assert resolve_output_path(target, suffix=".csv") == target
    assert os.path.isdir(os.path.dirname(target))


def test_download_response_removes_the_temporary_directory(tmp_path):
    temp_dir = tmp_path / "flightplan"
    temp_dir.mkdir()
    outpath = temp_dir / "mission.kmz"
    outpath.write_bytes(b"kmz")

    response = build_flightplan_download_response(
        str(outpath),
        drone_type=DroneType.DJI_MINI_4_PRO,
        filename_stem="task-1",
        cleanup_dir=str(temp_dir),
    )

    assert response.background is not None
    response.background.func(*response.background.args, **response.background.kwargs)
    assert not temp_dir.exists()


def test_download_response_without_cleanup_dir_keeps_the_file(tmp_path):
    outpath = tmp_path / "mission.kmz"
    outpath.write_bytes(b"kmz")

    response = build_flightplan_download_response(
        str(outpath),
        drone_type=DroneType.DJI_MINI_4_PRO,
        filename_stem="task-1",
    )

    assert response.background is None
    assert outpath.exists()
