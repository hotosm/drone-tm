"""add image classification fields

Revision ID: add_image_classification
Revises: 001_project_images, 7389d0d528c3
Create Date: 2025-01-06

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "add_image_classification"
down_revision = ("001_project_images", "7389d0d528c3")
branch_labels = None
depends_on = None


def upgrade():
    # Add batch_id column
    try:
        op.add_column(
            "project_images",
            sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        )
    except Exception:
        # Column might already exist
        pass

    # Add rejection_reason column
    try:
        op.add_column(
            "project_images", sa.Column("rejection_reason", sa.Text(), nullable=True)
        )
    except Exception:
        pass

    # Add sharpness_score column
    try:
        op.add_column(
            "project_images", sa.Column("sharpness_score", sa.Float(), nullable=True)
        )
    except Exception:
        pass

    # Create indexes
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_images_batch_id ON project_images (batch_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_images_batch_status ON project_images (batch_id, status)"
    )


def downgrade():
    op.drop_index("idx_project_images_batch_status", table_name="project_images")
    op.drop_index("idx_project_images_batch_id", table_name="project_images")
    op.drop_column("project_images", "sharpness_score")
    op.drop_column("project_images", "rejection_reason")
    op.drop_column("project_images", "batch_id")
