import asyncio
from app.arq.tasks import WorkerSettings
from arq.worker import check_health
from psycopg_pool import AsyncConnectionPool
from app.config import settings


async def check_db_health():
    try:
        async with AsyncConnectionPool(settings.DTM_DB_URL.unicode_string()) as pool:
            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT 1")
                    return True
    except Exception as e:
        print(f"Database health check failed: {e}")
        return False


if __name__ == "__main__":
    import asyncio

    asyncio.run(check_db_health())
    asyncio.run(check_health(WorkerSettings))
