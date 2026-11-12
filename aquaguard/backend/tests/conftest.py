import os

import pytest

# Tests never touch the network or an LLM.
os.environ.setdefault("AQUAGUARD_OFFLINE", "1")
os.environ.pop("LLM_API_KEY", None)


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)
