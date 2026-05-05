"""Add output_dem_url to projects

Revision ID: add_output_dem_url
Revises: add_thumbnail_url
Create Date: 2026-05-05

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "add_output_dem_url"
down_revision: Union[str, None] = "add_thumbnail_url"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    op.add_column("projects", sa.Column("output_dem_url", sa.String(), nullable=True))


def downgrade():
    op.drop_column("projects", "output_dem_url")
