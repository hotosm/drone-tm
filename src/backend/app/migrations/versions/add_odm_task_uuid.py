"""add odm_task_uuid column to tasks table

Revision ID: add_odm_task_uuid
Revises: rename_task_states
Create Date: 2026-04-01

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "add_odm_task_uuid"
down_revision: Union[str, None] = "rename_task_states"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("odm_task_uuid", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "odm_task_uuid")
