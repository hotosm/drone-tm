from alembic import op
from sqlalchemy.dialects import postgresql
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "b18103ac4ab7"
down_revision: Union[str, None] = "e23c05f21542"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Define the old and new enum types
old_enum = postgresql.ENUM(
    "REQUEST_FOR_MAPPING",
    "UNLOCKED_TO_MAP",
    "LOCKED_FOR_MAPPING",
    "UNLOCKED_TO_VALIDATE",
    "LOCKED_FOR_VALIDATION",
    "UNLOCKED_DONE",
    "UNFLYABLE_TASK",
    name="state",
)
new_enum = postgresql.ENUM(
    "REQUEST_FOR_MAPPING",
    "UNLOCKED_TO_MAP",
    "LOCKED_FOR_MAPPING",
    "UNLOCKED_TO_VALIDATE",
    "LOCKED_FOR_VALIDATION",
    "UNLOCKED_DONE",
    "UNFLYABLE_TASK",
    "IMAGE_UPLOADED",
    "IMAGE_PROCESSING_FAILED",
    "IMAGE_PROCESSING_STARTED",
    "IMAGE_PROCESSING_FINISHED",
    name="state",
)


def upgrade():
    # Add the new enum values
    old_enum.drop(op.get_bind(), checkfirst=False)
    new_enum.create(op.get_bind(), checkfirst=False)


def downgrade():
    # Revert to the old enum values
    new_enum.drop(op.get_bind(), checkfirst=False)
    old_enum.create(op.get_bind(), checkfirst=False)
