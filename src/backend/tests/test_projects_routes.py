import json
from io import BytesIO

import pytest
from loguru import logger as log


@pytest.mark.asyncio
async def test_create_project_with_files(
    client,
    project_info,
):
    """Test to verify the project creation API with file upload (image as binary data)."""
    project_info_json = json.dumps(project_info.model_dump())
    files = {
        "project_info": (None, project_info_json, "application/json"),
        "dem": None,
        "image": None,
    }

    files = {k: v for k, v in files.items() if v is not None}
    response = await client.post("/api/projects/", files=files)
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_upload_project_task_boundaries(client, create_test_project):
    """Test to verify the upload of task boundaries."""
    project_id = create_test_project
    log.debug(f"Testing project ID: {project_id}")
    task_geojson = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "coordinates": [
                            [
                                [85.32002733312942, 27.706336826417214],
                                [85.31945017091391, 27.705465823954995],
                                [85.32117509889912, 27.704809664174988],
                                [85.32135218276034, 27.70612197978899],
                                [85.32002733312942, 27.706336826417214],
                            ]
                        ],
                        "type": "Polygon",
                    },
                }
            ],
        }
    ).encode("utf-8")

    geojson_files = {
        "geojson": ("file.geojson", BytesIO(task_geojson), "application/geo+json")
    }
    response = await client.post(
        f"/projects/{project_id}/upload-task-boundaries", files=geojson_files
    )
    assert response.status_code == 200
    return response.json()


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
