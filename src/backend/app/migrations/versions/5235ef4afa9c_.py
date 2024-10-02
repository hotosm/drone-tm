"""

Revision ID: 5235ef4afa9c
Revises: b4338a93f7bb
Create Date: 2024-10-01 07:50:13.553835

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "5235ef4afa9c"
down_revision: Union[str, None] = "b4338a93f7bb"
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
    "UNFLYABLE_TASK",
    "IMAGE_UPLOADED",
    "IMAGE_PROCESSED",
    name="state",
)

old_state_enum = sa.Enum(
    "UNLOCKED_TO_MAP",
    "LOCKED_FOR_MAPPING",
    "UNLOCKED_TO_VALIDATE",
    "LOCKED_FOR_VALIDATION",
    "UNLOCKED_DONE",
    "REQUEST_FOR_MAPPING",
    "UNFLYABLE_TASK",
    name="state",
)


def upgrade() -> None:
    op.execute("ALTER TYPE state ADD VALUE 'IMAGE_UPLOADED'")
    op.execute("ALTER TYPE state ADD VALUE 'IMAGE_PROCESSED'")


def downgrade() -> None:
    # Rename the enum type
    op.execute("ALTER TYPE state RENAME TO state_old")
    # Recreate the old enum type
    old_state_enum.create(op.get_bind(), checkfirst=False)
    # Alter the column to use the old enum type
    op.execute(
        "ALTER TABLE task_events ALTER COLUMN state TYPE state_old USING state::state_old"
    )
    # Drop the old enum type
    op.execute("DROP TYPE state_old")
