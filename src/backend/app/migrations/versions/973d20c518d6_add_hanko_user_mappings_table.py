"""add_hanko_user_mappings_table

Revision ID: 973d20c518d6
Revises: 7389d0d528c3
Create Date: 2025-10-27 11:00:56.706931

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '973d20c518d6'
down_revision: Union[str, None] = '7389d0d528c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create hanko_user_mappings table
    op.create_table(
        "hanko_user_mappings",
        sa.Column("hanko_user_id", sa.String(), nullable=False),
        sa.Column("app_user_id", sa.String(), nullable=False),
        sa.Column("app_name", sa.String(), nullable=False, server_default="drone-tm"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("hanko_user_id"),
        sa.UniqueConstraint("hanko_user_id", "app_name", name="uq_hanko_app"),
    )
    # Create index for fast lookups by app_user_id
    op.create_index("idx_app_user_id", "hanko_user_mappings", ["app_user_id", "app_name"])


def downgrade() -> None:
    op.drop_index("idx_app_user_id", table_name="hanko_user_mappings")
    op.drop_table("hanko_user_mappings")
