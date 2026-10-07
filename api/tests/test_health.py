from httpx import AsyncClient


async def test_health_is_public_and_checks_db(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}
    assert response.headers["X-Request-ID"]


async def test_request_id_is_echoed(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "bff-abc.123"})

    assert response.headers["X-Request-ID"] == "bff-abc.123"


async def test_malformed_request_id_is_replaced(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "bad id\twith spaces"})

    assert response.headers["X-Request-ID"] != "bad id\twith spaces"
