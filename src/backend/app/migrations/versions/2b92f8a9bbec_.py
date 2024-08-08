"""

Revision ID: 2b92f8a9bbec
Revises: d862bfa31c36
Create Date: 2024-08-08 08:10:11.056119

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# Define the new enum type
new_state_enum = sa.Enum(
    "UNLOCKED_TO_MAP",
    "LOCKED_FOR_MAPPING",
    "UNLOCKED_TO_VALIDATE",
    "LOCKED_FOR_VALIDATION",
    "UNLOCKED_DONE",
    "REQUEST_FOR_MAPPING",
    "UNFLYABLE_TASK",
    name="state",
)

old_state_enum = sa.Enum(
    "UNLOCKED_TO_MAP",
    "LOCKED_FOR_MAPPING",
    "UNLOCKED_TO_VALIDATE",
    "LOCKED_FOR_VALIDATION",
    "UNLOCKED_DONE",
    "REQUEST_FOR_MAPPING",
    name="state",
)

# revision identifiers, used by Alembic.
revision: str = "2b92f8a9bbec"
down_revision: Union[str, None] = "5d38e368b3d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE state ADD VALUE 'UNFLYABLE_TASK'")


def downgrade() -> None:
    op.execute("ALTER TYPE state RENAME TO state_old")

    old_state_enum.create(op.get_bind(), checkfirst=False)
    op.execute("ALTER TABLE task_events ALTER COLUMN state TYPE text USING state::text")
    # op.execute(
    #     "ALTER TABLE task_events ALTER COLUMN state TYPE state USING state::text::state"
    # )
    op.execute("DROP TYPE state_old")
