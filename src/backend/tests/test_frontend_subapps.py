from app.main import _mount_frontend_subapps
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_mount_frontend_subapps_serves_bundled_index(tmp_path):
    plan_dir = tmp_path / "plan"
    plan_dir.mkdir()
    (plan_dir / "index.html").write_text("flight planner", encoding="utf-8")

    app = FastAPI(redirect_slashes=False)
    _mount_frontend_subapps(app, str(tmp_path))

    response = TestClient(app).get("/plan/")

    assert response.status_code == 200
    assert response.text == "flight planner"
