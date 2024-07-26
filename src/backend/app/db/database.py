"""Config for the DTM database connection."""

from databases import Database
from app.config import settings


class DatabaseConnection:
    """Manages database connection (sqlalchemy & encode databases)"""

    def __init__(self):
        self.database = Database(
            settings.DTM_DB_URL.unicode_string(),
            min_size=5,
            max_size=20,
        )

    async def connect(self):
        """Connect to the database."""
        await self.database.connect()

    async def disconnect(self):
        """Disconnect from the database."""
        await self.database.disconnect()


db_connection = DatabaseConnection()


async def get_db():
    """Get the encode database connection"""
    await db_connection.connect()
    yield db_connection.database
