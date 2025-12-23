import pytest


@pytest.mark.asyncio
async def test_list_tasks(client):
    """Test listing tasks for the authenticated user."""
    response = await client.get("/api/tasks/")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_task_states(client, create_test_project):
    project_id = create_test_project

    response = await client.get(f"/api/tasks/states/{project_id}")
    assert response.status_code == 200
