from sqlalchemy.orm import Session
from app.projects import project_schemas
from app.db import db_models


async def create_project_with_project_info(
    db: Session, project_metadata: project_schemas.ProjectIn
):
    """Create a project in database."""
    db_project = db_models.DbProject(
        author_id=1, **project_metadata.model_dump(exclude=["outline_geojson"])
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project
