import asyncio
from app.arq.tasks import WorkerSettings
from arq.worker import check_health

if __name__ == "__main__":
    asyncio.run(check_health(WorkerSettings))
