"""

Revision ID: 2803924c6ff9
Revises: 4ea77c60b715
Create Date: 2024-11-18 06:40:07.595863

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "2803924c6ff9"
down_revision: Union[str, None] = "3cd04bfdb1e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column(
        "user_profile", sa.Column("certificate_url", sa.String(), nullable=True)
    )
    op.add_column(
        "user_profile",
        sa.Column("registration_certificate_url", sa.String(), nullable=True),
    )
    op.drop_column("user_profile", "certificate")
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.add_column(
        "user_profile",
        sa.Column(
            "certificate", postgresql.BYTEA(), autoincrement=False, nullable=True
        ),
    )
    op.drop_column("user_profile", "registration_certificate_url")
    op.drop_column("user_profile", "certificate_url")
    # ### end Alembic commands ###
