import pytest

from app.models.enums import HTTPStatus


@pytest.mark.asyncio
async def test_find_images_for_a_project(client, create_test_project):
    """Smoke test for finding images in a project that contain a point."""
    project_id = create_test_project
    point_data = {"longitude": 0.0, "latitude": 0.0}

    response = await client.post(
        f"/api/gcp/find-project-images/?project_id={project_id}",
        json=point_data,
    )

    assert response.status_code == HTTPStatus.OK
