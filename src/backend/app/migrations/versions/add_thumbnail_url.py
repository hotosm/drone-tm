"""add thumbnail_url to project_images

Revision ID: add_thumbnail_url
Revises: add_image_classification
Create Date: 2025-01-08

"""

from alembic import op
import sqlalchemy as sa

revision = "add_thumbnail_url"
down_revision = "add_image_classification"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()

    # Check if thumbnail_url column exists
    thumbnail_url_exists = connection.execute(
        sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'project_images'
            AND column_name = 'thumbnail_url'
        )
    """)
    ).scalar()

    if not thumbnail_url_exists:
        op.add_column(
            "project_images",
            sa.Column("thumbnail_url", sa.Text(), nullable=True),
        )

    # Create index for efficient querying
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_images_thumbnail_url ON project_images (thumbnail_url) WHERE thumbnail_url IS NOT NULL"
    )


def downgrade():
    op.drop_index(
        "idx_project_images_thumbnail_url", table_name="project_images", if_exists=True
    )
    op.drop_column("project_images", "thumbnail_url")
