"""add terrain_type column to project_images

Revision ID: add_terrain_type
Revises: rename_task_states
Create Date: 2026-04-18

"""

from alembic import op
import sqlalchemy as sa

revision = "add_terrain_type"
down_revision = "rename_task_states"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "project_images",
        sa.Column("terrain_type", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_column("project_images", "terrain_type")
