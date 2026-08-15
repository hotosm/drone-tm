from pathlib import Path

import pytest
from app.waypoints.flightplan_output import (
    build_flightplan_download_response,
    create_flightplan_workspace,
    remove_flightplan_workspace,
)
from drone_flightplan.drone_type import DroneType


@pytest.mark.asyncio
async def test_download_response_removes_temporary_workspace(tmp_path: Path):
    workspace = tmp_path / "flightplan-workspace"
    workspace.mkdir()
    output = workspace / "output.kmz"
    output.write_bytes(b"flightplan")
    intermediate = workspace / "writer-intermediate"
    intermediate.mkdir()
    (intermediate / "waylines.wpml").write_text("temporary", encoding="utf-8")

    response = build_flightplan_download_response(
        str(output),
        drone_type=DroneType.DJI_MINI_4_PRO,
        filename_stem="task-1",
        cleanup_dir=str(workspace),
    )

    assert workspace.exists()
    assert response.background is not None

    await response.background()

    assert not workspace.exists()


def test_download_response_does_not_remove_unmanaged_output(tmp_path: Path):
    output = tmp_path / "output.kmz"
    output.write_bytes(b"flightplan")

    response = build_flightplan_download_response(
        str(output),
        drone_type=DroneType.DJI_MINI_4_PRO,
        filename_stem="task-1",
    )

    assert response.background is None
    assert output.exists()


def test_workspace_helpers_create_and_remove_complete_workspace():
    workspace, output = create_flightplan_workspace()
    intermediate = Path(workspace) / "writer-intermediate"
    intermediate.mkdir()
    (intermediate / "temporary.txt").write_text("temporary", encoding="utf-8")

    assert Path(workspace).is_dir()
    assert Path(output).parent == Path(workspace)

    remove_flightplan_workspace(workspace)
    remove_flightplan_workspace(workspace)

    assert not Path(workspace).exists()
