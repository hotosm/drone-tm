"""Rename task states to match drone workflow

Revision ID: rename_task_states
Revises: a003df57e169
Create Date: 2026-03-30

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "rename_task_states"
down_revision: Union[str, None] = "a003df57e169"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TYPE state RENAME VALUE 'REQUEST_FOR_MAPPING' TO 'AWAITING_APPROVAL'"
    )
    op.execute("ALTER TYPE state RENAME VALUE 'UNLOCKED_TO_MAP' TO 'UNLOCKED'")
    op.execute("ALTER TYPE state RENAME VALUE 'LOCKED_FOR_MAPPING' TO 'LOCKED'")
    op.execute("ALTER TYPE state RENAME VALUE 'UNLOCKED_TO_VALIDATE' TO 'FULLY_FLOWN'")
    op.execute("ALTER TYPE state RENAME VALUE 'LOCKED_FOR_VALIDATION' TO 'HAS_IMAGERY'")
    op.execute(
        "ALTER TYPE state RENAME VALUE 'UNLOCKED_DONE' TO 'READY_FOR_PROCESSING'"
    )
    op.execute("ALTER TYPE state RENAME VALUE 'UNFLYABLE_TASK' TO 'HAS_ISSUES'")
    # Migrate existing IMAGE_UPLOADED data to READY_FOR_PROCESSING
    op.execute(
        "UPDATE task_events SET state = 'READY_FOR_PROCESSING' WHERE state = 'IMAGE_UPLOADED'"
    )


def downgrade() -> None:
    # Reverse the data migration first
    op.execute(
        "UPDATE task_events SET state = 'IMAGE_UPLOADED' WHERE state = 'READY_FOR_PROCESSING'"
    )
    op.execute(
        "ALTER TYPE state RENAME VALUE 'AWAITING_APPROVAL' TO 'REQUEST_FOR_MAPPING'"
    )
    op.execute("ALTER TYPE state RENAME VALUE 'UNLOCKED' TO 'UNLOCKED_TO_MAP'")
    op.execute("ALTER TYPE state RENAME VALUE 'LOCKED' TO 'LOCKED_FOR_MAPPING'")
    op.execute("ALTER TYPE state RENAME VALUE 'FULLY_FLOWN' TO 'UNLOCKED_TO_VALIDATE'")
    op.execute("ALTER TYPE state RENAME VALUE 'HAS_IMAGERY' TO 'LOCKED_FOR_VALIDATION'")
    op.execute(
        "ALTER TYPE state RENAME VALUE 'READY_FOR_PROCESSING' TO 'UNLOCKED_DONE'"
    )
    op.execute("ALTER TYPE state RENAME VALUE 'HAS_ISSUES' TO 'UNFLYABLE_TASK'")
