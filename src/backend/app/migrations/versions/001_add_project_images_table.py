"""add_project_images_table

Revision ID: 001_project_images
Revises: fa5c74996273
Create Date: 2025-10-26 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from geoalchemy2 import Geometry

# revision identifiers, used by Alembic.
revision: str = "001_project_images"
down_revision: Union[str, None] = "fa5c74996273"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create enum type for image status (only if it doesn't exist)
    connection = op.get_bind()
    result = connection.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_status')")
    ).scalar()

    if not result:
        image_status_enum = postgresql.ENUM(
            "staged",
            "classified",
            "invalid_exif",
            "unmatched",
            "duplicate",
            name="image_status",
            create_type=False,
        )
        image_status_enum.create(op.get_bind(), checkfirst=False)

    # Create project_images table
    op.create_table(
        "project_images",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("s3_key", sa.Text(), nullable=False),
        sa.Column("hash_md5", sa.CHAR(32), nullable=False),
        sa.Column("location", Geometry("POINT", srid=4326), nullable=True),
        sa.Column("exif", postgresql.JSONB(), nullable=True),
        sa.Column(
            "uploaded_by",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "uploaded_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("classified_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(
                "staged",
                "classified",
                "invalid_exif",
                "unmatched",
                "duplicate",
                name="image_status",
                create_type=False,
            ),
            server_default="staged",
            nullable=False,
        ),
        sa.Column(
            "duplicate_of",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_images.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Create indexes for better query performance (if they don't exist)
    op.create_index(
        "idx_project_images_project_id",
        "project_images",
        ["project_id"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "idx_project_images_task_id",
        "project_images",
        ["task_id"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "idx_project_images_status",
        "project_images",
        ["status"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "idx_project_images_hash_md5",
        "project_images",
        ["hash_md5"],
        unique=False,
        if_not_exists=True,
    )
    op.create_index(
        "idx_project_images_uploaded_by",
        "project_images",
        ["uploaded_by"],
        unique=False,
        if_not_exists=True,
    )

    # Create spatial index on location (if it doesn't exist)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_images_location ON project_images USING GIST (location);"
    )


def downgrade() -> None:
    # Drop table and enum
    op.drop_table("project_images")

    # Drop enum type
    image_status_enum = postgresql.ENUM(name="image_status")
    image_status_enum.drop(op.get_bind(), checkfirst=True)
