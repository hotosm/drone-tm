"""Rename output_raw_url to output_odm_assets_url on projects

Revision ID: rename_output_raw_url
Revises: add_output_dem_url
Create Date: 2026-05-05

output_raw_url was never used. Repurposed to store the streaming endpoint
path for the project-level ODM assets ZIP download, with a clearer name.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "rename_output_raw_url"
down_revision: Union[str, None] = "add_output_dem_url"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    op.alter_column(
        "projects", "output_raw_url", new_column_name="output_odm_assets_url"
    )


def downgrade():
    op.alter_column(
        "projects", "output_odm_assets_url", new_column_name="output_raw_url"
    )
