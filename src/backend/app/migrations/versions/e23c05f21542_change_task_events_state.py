"""change task events state

Revision ID: e23c05f21542
Revises: 8ae4e43a7011
Create Date: 2024-12-06 08:00:16.223517

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e23c05f21542"
down_revision: Union[str, None] = "8ae4e43a7011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

old_state_enum = sa.Enum(
    "REQUEST_FOR_MAPPING",
    "UNLOCKED_TO_MAP",
    "LOCKED_FOR_MAPPING",
    "UNLOCKED_TO_VALIDATE",
    "LOCKED_FOR_VALIDATION",
    "UNLOCKED_DONE",
    "UNFLYABLE_TASK",
    "IMAGE_UPLOADED",
    "IMAGE_PROCESSED",
    "IMAGE_PROCESSING_FAILED",
    name="state",
)

new_state_enum = sa.Enum(
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
    name="state_new",
)


def upgrade():
    # Step 1: Create the new enum type
    new_state_enum.create(op.get_bind())

    # Step 2: Add a new column with the new enum type
    op.add_column("task_events", sa.Column("new_state", new_state_enum, nullable=True))

    # # Step 3: Populate the new state column with the transformed data
    # op.execute(
    #     """
    #     UPDATE task_events
    #     SET new_state =
    #         CASE
    #             WHEN state = 'IMAGE_PROCESSED' THEN 'IMAGE_PROCESSING_FINISHED'
    #             ELSE state::text
    #         END::state_new
    #     """
    # )

    # Step 4: Drop the old state column
    op.drop_column("task_events", "state")

    # Step 5: Rename the new_state column to state
    op.alter_column("task_events", "new_state", new_column_name="state")

    # Step 6: Drop the old enum type
    op.execute("DROP TYPE state;")

    # Step 7: Rename the new enum type to state
    op.execute("ALTER TYPE state_new RENAME TO state;")

    ## then add the image processing started state to all the image uploaded file
    op.execute("""
        WITH added_image_processing_started AS (
            SELECT gen_random_uuid() AS event_id,
            task_id,
            project_id,
            user_id,
            created_at + INTERVAL '10 seconds' AS created_at,
            comment,
            created_at + INTERVAL '10 seconds' AS updated_at,
            'IMAGE_PROCESSING_STARTED'::state AS state
            FROM task_events WHERE state = 'IMAGE_UPLOADED'
        )
        INSERT INTO task_events (event_id, task_id, project_id, user_id, created_at, comment, updated_at, state)
        SELECT event_id, task_id, project_id, user_id, created_at, comment, updated_at, state
        FROM added_image_processing_started;
    """)


def downgrade():
    op.execute("DELETE from task_events WHERE state = 'IMAGE_PROCESSING_STARTED';")
    # Step 1: Rename the new enum type back to the old name
    op.execute("ALTER TYPE state RENAME TO state_new;")

    # Step 2: Create the old enum type again (assuming you have the definition of the old enum type)
    # You would need to define the old state enum type here, e.g.:
    old_state_enum.create(op.get_bind())

    # Step 3: Add the old state column with the old enum type
    op.add_column("task_events", sa.Column("state_old", old_state_enum, nullable=True))

    # # Step 4: Populate the old state column with the transformed data
    # op.execute(
    #     """
    #     UPDATE task_events
    #     SET state_old =
    #         CASE
    #             WHEN state = 'IMAGE_PROCESSING_FINISHED' THEN 'IMAGE_PROCESSED'
    #             ELSE state::text
    #         END::state
    #     """
    # )

    # Step 5: Drop the new_state column
    op.drop_column("task_events", "state")
    op.alter_column("task_events", "state_old", new_column_name="state")

    # Step 6: Drop the new enum type
    op.execute("DROP TYPE state_new;")
