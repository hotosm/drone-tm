"""

Revision ID: 06668eb5d14a
Revises: fa5c74996273
Create Date: 2024-07-09 04:17:49.816148

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "06668eb5d14a"
down_revision: Union[str, None] = "fa5c74996273"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Define the new enum type
new_state_enum = sa.Enum(
    "UNLOCKED_TO_MAP",
    "LOCKED_FOR_MAPPING",
    "UNLOCKED_TO_VALIDATE",
    "LOCKED_FOR_VALIDATION",
    "UNLOCKED_DONE",
    "REQUEST_FOR_MAPPING",
    name="state",
)

old_state_enum = sa.Enum(
    "UNLOCKED_TO_MAP",
    "LOCKED_FOR_MAPPING",
    "UNLOCKED_TO_VALIDATE",
    "LOCKED_FOR_VALIDATION",
    "UNLOCKED_DONE",
    name="state",
)


def upgrade():
    op.execute("ALTER TYPE state ADD VALUE 'REQUEST_FOR_MAPPING'")


def downgrade():
    # Downgrade the enum type by recreating it without the new value
    op.execute("ALTER TYPE state RENAME TO state_old")
    old_state_enum.create(op.get_bind(), checkfirst=False)
    op.execute(
        (
            "ALTER TABLE task_events "
            "ALTER COLUMN state TYPE state USING state::text::state"
        )
    )
    op.execute("DROP TYPE state_old")
