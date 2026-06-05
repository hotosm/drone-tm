"""Add cloudnative generating flags, drop TEXTURED_MODEL_3D from finaloutput

Revision ID: b2d6f3a91c47
Revises: e4a8c2f1b9d6
Create Date: 2026-06-05

Two related schema changes for the user-triggered cloudnative conversion
flow, bundled so prod takes them in one step:

1. Add ``cloud_ortho_generating`` and ``cloud_mesh_generating`` columns to
   the ``projects`` table. Tracks an in-flight conversion job: set true by
   the trigger endpoint (POST ``/projects/{id}/cloudnative/orthophoto`` or
   ``.../mesh``), cleared in the worker's finally block. Drives the
   Convert -> Converting -> View tri-state button in the project UI.

2. Drop ``TEXTURED_MODEL_3D`` from the ``finaloutput`` enum. The textured
   3D mesh is always produced by ODM (unless ``--skip-3dmodel`` was passed,
   which we don't do). The 3D Convert button is now gated on probing S3
   for the mesh source file, not on the user having ticked the option at
   create time. The enum value was never selectable in the create UI
   anyway - purely a cleanup.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b2d6f3a91c47"
down_revision: Union[str, None] = "e4a8c2f1b9d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add the generating flags.
    op.add_column(
        "projects",
        sa.Column(
            "cloud_ortho_generating",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "cloud_mesh_generating",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # 2. Drop TEXTURED_MODEL_3D from the finaloutput enum. Same dance as
    #    7f3a8b9c2d1e: PostgreSQL can't drop enum values directly, so we
    #    cast the column to TEXT[], strip the value, drop and recreate
    #    the enum, then cast back.
    op.execute(
        "ALTER TABLE projects ALTER COLUMN final_output TYPE TEXT[] "
        "USING final_output::TEXT[]"
    )
    op.execute(
        "UPDATE projects "
        "SET final_output = array_remove(final_output, 'TEXTURED_MODEL_3D') "
        "WHERE 'TEXTURED_MODEL_3D' = ANY(final_output)"
    )
    op.execute("DROP TYPE finaloutput")
    op.execute(
        "CREATE TYPE finaloutput AS ENUM ("
        "'ORTHOPHOTO_2D', 'DIGITAL_TERRAIN_MODEL', "
        "'DIGITAL_SURFACE_MODEL', 'POINT_CLOUD')"
    )
    op.execute(
        "ALTER TABLE projects ALTER COLUMN final_output TYPE finaloutput[] "
        "USING final_output::finaloutput[]"
    )


def downgrade() -> None:
    # Reverse #2: restore TEXTURED_MODEL_3D as a valid enum value. Existing
    # arrays never had it after upgrade (we stripped it), so no row content
    # restoration is needed.
    op.execute(
        "ALTER TABLE projects ALTER COLUMN final_output TYPE TEXT[] "
        "USING final_output::TEXT[]"
    )
    op.execute("DROP TYPE finaloutput")
    op.execute(
        "CREATE TYPE finaloutput AS ENUM ("
        "'ORTHOPHOTO_2D', 'TEXTURED_MODEL_3D', 'DIGITAL_TERRAIN_MODEL', "
        "'DIGITAL_SURFACE_MODEL', 'POINT_CLOUD')"
    )
    op.execute(
        "ALTER TABLE projects ALTER COLUMN final_output TYPE finaloutput[] "
        "USING final_output::finaloutput[]"
    )

    # Reverse #1: drop the generating flags.
    op.drop_column("projects", "cloud_mesh_generating")
    op.drop_column("projects", "cloud_ortho_generating")
