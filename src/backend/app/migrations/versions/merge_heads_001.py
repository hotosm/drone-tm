"""merge heads - project_images and hanko_user_mappings

Revision ID: merge_001
Revises: 001_project_images, 973d20c518d6
Create Date: 2025-12-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "merge_001"
down_revision: Union[str, Sequence[str], None] = ("001_project_images", "973d20c518d6")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
