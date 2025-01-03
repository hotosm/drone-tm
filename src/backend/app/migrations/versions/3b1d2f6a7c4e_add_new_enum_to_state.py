from alembic import op
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = "3b1d2f6a7c4e"
down_revision: Union[str, None] = "b18103ac4ab7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade():
    bind = op.get_bind()

    # Ensure ENUM type is created if it doesn't exist
    bind.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'state') THEN
                CREATE TYPE state AS ENUM (
                    'REQUEST_FOR_MAPPING',
                    'UNLOCKED_TO_MAP',
                    'LOCKED_FOR_MAPPING',
                    'UNLOCKED_TO_VALIDATE',
                    'LOCKED_FOR_VALIDATION',
                    'UNLOCKED_DONE',
                    'UNFLYABLE_TASK',
                    'IMAGE_UPLOADED',
                    'IMAGE_PROCESSING_FAILED',
                    'IMAGE_PROCESSING_STARTED',
                    'IMAGE_PROCESSING_FINISHED'
                );
            END IF;
        END $$;
        """
    )

    # Alter column if not already updated
    bind.execute(
        """
        ALTER TABLE task_events
        ALTER COLUMN state
        TYPE state
        USING state::text::state;
        """
    )

    # Add columns only if they don't exist
    bind.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'tasks' AND column_name = 'total_area_sqkm'
            ) THEN
                ALTER TABLE tasks ADD COLUMN total_area_sqkm FLOAT;
            END IF;
        END $$;
        """
    )
    bind.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'tasks' AND column_name = 'flight_time_minutes'
            ) THEN
                ALTER TABLE tasks ADD COLUMN flight_time_minutes FLOAT;
            END IF;
        END $$;
        """
    )
    bind.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'tasks' AND column_name = 'flight_distance_km'
            ) THEN
                ALTER TABLE tasks ADD COLUMN flight_distance_km FLOAT;
            END IF;
        END $$;
        """
    )
    bind.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'tasks' AND column_name = 'total_image_uploaded'
            ) THEN
                ALTER TABLE tasks ADD COLUMN total_image_uploaded SMALLINT;
            END IF;
        END $$;
        """
    )
    bind.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = 'tasks' AND column_name = 'assets_url'
            ) THEN
                ALTER TABLE tasks ADD COLUMN assets_url VARCHAR;
            END IF;
        END $$;
        """
    )


def downgrade():
    # Ensure this matches the previous ENUM state during downgrade

    bind = op.get_bind()

    # Revert ENUM type
    bind.execute(
        """
        ALTER TABLE task_events
        ALTER COLUMN state
        TYPE text;
        """
    )
    bind.execute("DROP TYPE IF EXISTS state;")

    # Drop columns if they exist
    bind.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS assets_url;")
    bind.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS total_image_uploaded;")
    bind.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS flight_distance_km;")
    bind.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS flight_time_minutes;")
    bind.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS total_area_sqkm;")
