"""add project dem_source

Revision ID: c1f4a7e9b2d0
Revises: 7ed1c618666b
Create Date: 2026-09-04 15:20:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1f4a7e9b2d0"
down_revision: str | None = "7ed1c618666b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    demsource = sa.Enum("GLO30", "JAXA", "UPLOAD", name="demsource")
    demsource.create(op.get_bind(), checkfirst=True)

    # Existing projects have no reliable DEM source history.
    op.add_column("projects", sa.Column("dem_source", demsource, nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "dem_source")
    sa.Enum(name="demsource").drop(op.get_bind(), checkfirst=True)
