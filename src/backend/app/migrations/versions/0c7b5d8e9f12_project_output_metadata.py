"""Add project ODM metadata and output URLs

Revision ID: 0c7b5d8e9f12
Revises: 973d20c518d6
Create Date: 2026-05-05

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0c7b5d8e9f12"
down_revision: Union[str, None] = "973d20c518d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("odm_task_uuid", sa.String(), nullable=True))
    op.add_column(
        "projects", sa.Column("odm_endpoint_used", sa.String(), nullable=True)
    )
    op.add_column("projects", sa.Column("output_dem_url", sa.String(), nullable=True))
    op.alter_column(
        "projects", "output_raw_url", new_column_name="output_odm_assets_url"
    )


def downgrade() -> None:
    op.alter_column(
        "projects", "output_odm_assets_url", new_column_name="output_raw_url"
    )
    op.drop_column("projects", "output_dem_url")
    op.drop_column("projects", "odm_endpoint_used")
    op.drop_column("projects", "odm_task_uuid")
