from typing import Sequence, Union
from alembic import op
from app.models.enums import UserRole
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text


# revision identifiers, used by Alembic.
revision: str = "b36a13183a83"
down_revision: Union[str, None] = "5235ef4afa9c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # Check if the enum type 'userrole' already exists
    conn = op.get_bind()
    result = conn.execute(text("SELECT 1 FROM pg_type WHERE typname = 'userrole';")).scalar()

    if not result:
        # Create a new enum type for user roles if it doesn't exist
        userrole_enum = sa.Enum(UserRole, name="userrole")
        userrole_enum.create(op.get_bind())

    # Change the column from a single enum value to an array of enums
    # We need to cast each enum value to text and back to an array of enums
    op.alter_column("user_profile", "role", 
                    existing_type=sa.Enum(UserRole, name="userrole"), 
                    type_=sa.ARRAY(postgresql.ENUM("PROJECT_CREATOR", "DRONE_PILOT", name="userrole")), 
                    postgresql_using="ARRAY[role]::userrole[]",  # Convert the single enum to an array
                    nullable=True)

def downgrade() -> None:
    # Change the column back from an array to a single enum value
    op.alter_column("user_profile", "role", 
                    existing_type=sa.ARRAY(postgresql.ENUM("PROJECT_CREATOR", "DRONE_PILOT", name="userrole")), 
                    type_=sa.Enum(UserRole, name="userrole"), 
                    postgresql_using="role[1]", 
                    nullable=True)

    # Drop the enum type only if it exists
    conn = op.get_bind()
    result = conn.execute(text("SELECT 1 FROM pg_type WHERE typname = 'userrole';")).scalar()

    if result:
        userrole_enum = sa.Enum(UserRole, name="userrole")
        userrole_enum.drop(op.get_bind())
