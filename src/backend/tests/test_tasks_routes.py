import pytest
import uuid


@pytest.mark.asyncio
async def test_read_task(client):
    task_id = uuid.uuid4()
    response = await client.get(f"/api/tasks/{task_id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_task_states(client, create_test_project):
    project_id = create_test_project

    response = await client.get(f"/api/tasks/states/{project_id}")
    assert response.status_code == 200
