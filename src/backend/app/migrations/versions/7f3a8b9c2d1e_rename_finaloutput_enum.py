"""Rename ORTHOPHOTO_3D to TEXTURED_MODEL_3D and add POINT_CLOUD to finaloutput enum

Revision ID: 7f3a8b9c2d1e
Revises: 0c7b5d8e9f12
Create Date: 2026-05-07

"""

from typing import Sequence, Union

from alembic import op


revision: str = "7f3a8b9c2d1e"
down_revision: Union[str, None] = "0c7b5d8e9f12"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL can't rename or remove enum values directly, so we:
    # 1. Cast the column to TEXT[] temporarily
    # 2. Drop and recreate the enum type with the corrected values
    # 3. Migrate any rows that stored the old ORTHOPHOTO_3D value
    # 4. Cast the column back to the new enum[]
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
    # Migrate any rows that stored the old value (precautionary - it was never
    # selectable in the UI, but belt-and-braces).
    op.execute(
        "UPDATE projects "
        "SET final_output = array_replace(final_output, 'ORTHOPHOTO_3D', 'TEXTURED_MODEL_3D') "
        "WHERE 'ORTHOPHOTO_3D' = ANY(final_output)"
    )
    op.execute(
        "ALTER TABLE projects ALTER COLUMN final_output TYPE finaloutput[] "
        "USING final_output::finaloutput[]"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE projects ALTER COLUMN final_output TYPE TEXT[] "
        "USING final_output::TEXT[]"
    )
    # Remove values that don't exist in the old enum before casting back.
    op.execute(
        "UPDATE projects "
        "SET final_output = array_remove(final_output, 'TEXTURED_MODEL_3D') "
        "WHERE 'TEXTURED_MODEL_3D' = ANY(final_output)"
    )
    op.execute(
        "UPDATE projects "
        "SET final_output = array_remove(final_output, 'POINT_CLOUD') "
        "WHERE 'POINT_CLOUD' = ANY(final_output)"
    )
    op.execute("DROP TYPE finaloutput")
    op.execute(
        "CREATE TYPE finaloutput AS ENUM ("
        "'ORTHOPHOTO_2D', 'ORTHOPHOTO_3D', 'DIGITAL_TERRAIN_MODEL', "
        "'DIGITAL_SURFACE_MODEL')"
    )
    op.execute(
        "ALTER TABLE projects ALTER COLUMN final_output TYPE finaloutput[] "
        "USING final_output::finaloutput[]"
    )
