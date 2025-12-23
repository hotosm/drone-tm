import json
import uuid
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


@pytest.mark.asyncio
async def test_read_projects(client):
    """Test reading all projects."""
    response = await client.get("/api/projects/")
    assert response.status_code == 200
    assert "results" in response.json()


@pytest.mark.asyncio
async def test_read_project(client, create_test_project):
    """Test reading a single project."""
    project_id = create_test_project
    response = await client.get(f"/api/projects/{project_id}")
    assert response.status_code == 200
    assert response.json()["id"] == project_id


@pytest.mark.asyncio
async def test_read_project_centroids(client):
    """Test reading project centroids."""
    response = await client.get("/api/projects/centroids")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_initiate_multipart_upload(client, create_test_project):
    """Test initiating a multipart upload."""
    project_id = create_test_project
    task_id = uuid.uuid4()  # Dummy task id for the purpose of this test
    request_data = {
        "project_id": project_id,
        "task_id": str(task_id),
        "file_name": "test_image.jpg",
        "staging": False,
    }
    response = await client.post(
        "/api/projects/initiate-multipart-upload/", json=request_data
    )
    assert response.status_code == 200
    assert "upload_id" in response.json()


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
