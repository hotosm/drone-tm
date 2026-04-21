"""Rename task states to match drone workflow

Revision ID: rename_task_states
Revises: a003df57e169
Create Date: 2026-03-30

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "rename_task_states"
down_revision: Union[str, None] = "a003df57e169"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enum_value_exists(conn, enum_name: str, value: str) -> bool:
    """Check if an enum value exists in the given PostgreSQL enum type."""
    result = conn.execute(
        sa.text(
            "SELECT EXISTS ("
            "  SELECT 1 FROM pg_enum e"
            "  JOIN pg_type t ON e.enumtypid = t.oid"
            "  WHERE t.typname = :enum_name AND e.enumlabel = :value"
            ")"
        ),
        {"enum_name": enum_name, "value": value},
    )
    return result.scalar()


def _safe_rename_enum_value(conn, enum_name: str, old: str, new: str) -> None:
    """Rename an enum value only if the old value still exists."""
    if _enum_value_exists(conn, enum_name, old):
        conn.execute(sa.text(f"ALTER TYPE {enum_name} RENAME VALUE '{old}' TO '{new}'"))


def upgrade() -> None:
    conn = op.get_bind()
    _safe_rename_enum_value(conn, "state", "REQUEST_FOR_MAPPING", "AWAITING_APPROVAL")
    _safe_rename_enum_value(conn, "state", "UNLOCKED_TO_MAP", "UNLOCKED")
    _safe_rename_enum_value(conn, "state", "LOCKED_FOR_MAPPING", "LOCKED")
    _safe_rename_enum_value(conn, "state", "UNLOCKED_TO_VALIDATE", "FULLY_FLOWN")
    _safe_rename_enum_value(conn, "state", "LOCKED_FOR_VALIDATION", "HAS_IMAGERY")
    _safe_rename_enum_value(conn, "state", "UNLOCKED_DONE", "READY_FOR_PROCESSING")
    _safe_rename_enum_value(conn, "state", "UNFLYABLE_TASK", "HAS_ISSUES")
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
