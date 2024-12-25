import pytest
import json


@pytest.mark.asyncio
async def test_create_project_with_files(
    client,
    project_info,
):
    """
    Test to verify the project creation API with file upload (image as binary data).
    """
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


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
