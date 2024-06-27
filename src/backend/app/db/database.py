"""Config for the DTM database connection."""
from databases import Database
from app.config import settings
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

database = Database(settings.DTM_DB_URL.unicode_string())
Base = declarative_base()
DtmMetadata = Base.metadata

engine = create_engine(
    settings.DTM_DB_URL.unicode_string(),
    pool_size=20,
    max_overflow=-1,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Create SQLAlchemy DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

##encode databases..
async def connect_db():
    """Connect to the database."""
    await database.connect()
    
async def disconnect_db():
    """Disconnect from the database."""
    await database.disconnect()
    
async def encode_db():
    """Get the database connection"""
    try:
        await connect_db()
        yield database
    finally:
        await disconnect_db()
