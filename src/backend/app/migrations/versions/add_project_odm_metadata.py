"""add odm_task_uuid and odm_endpoint_used to projects table

Revision ID: add_project_odm_metadata
Revises: add_odm_task_uuid
Create Date: 2026-04-13

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_project_odm_metadata"
down_revision: Union[str, None] = "add_odm_task_uuid"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("odm_task_uuid", sa.String(), nullable=True))
    op.add_column(
        "projects", sa.Column("odm_endpoint_used", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("projects", "odm_endpoint_used")
    op.drop_column("projects", "odm_task_uuid")
