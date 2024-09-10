import os
print("Current working directory:", os.getcwd())



import pytest
from fastapi.testclient import TestClient
from app.main import get_application
from app.db.database import get_db
from typing import AsyncGenerator, Any
from fastapi import FastAPI


@pytest.fixture(autouse=True)
async def app() -> AsyncGenerator[FastAPI, Any]:
    """Get the FastAPI test server."""
    application = await get_application()
    yield application


@pytest.fixture(scope="function")
def client(app: FastAPI, db):
    """The FastAPI test server."""
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c


if __name__ == "__main__":
    """Main func if file invoked directly."""
    pytest.main()
