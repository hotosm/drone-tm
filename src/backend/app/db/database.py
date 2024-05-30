"""Config for the DTM database connection."""

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(
    settings.DTM_DB_URL.unicode_string(),
    pool_size=20,
    max_overflow=-1,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
DtmMetadata = Base.metadata


def get_db():
    """Create SQLAlchemy DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
