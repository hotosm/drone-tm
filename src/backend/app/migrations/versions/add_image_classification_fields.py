"""add image classification fields

Revision ID: add_image_classification
Revises: 001_project_images
Create Date: 2025-01-06

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "add_image_classification"
down_revision = "001_project_images"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()

    # Check if batch_id column exists
    batch_id_exists = connection.execute(
        sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'project_images'
            AND column_name = 'batch_id'
        )
    """)
    ).scalar()

    if not batch_id_exists:
        op.add_column(
            "project_images",
            sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        )

    # Check if rejection_reason column exists
    rejection_reason_exists = connection.execute(
        sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'project_images'
            AND column_name = 'rejection_reason'
        )
    """)
    ).scalar()

    if not rejection_reason_exists:
        op.add_column(
            "project_images", sa.Column("rejection_reason", sa.Text(), nullable=True)
        )

    # Check if sharpness_score column exists
    sharpness_score_exists = connection.execute(
        sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'project_images'
            AND column_name = 'sharpness_score'
        )
    """)
    ).scalar()

    if not sharpness_score_exists:
        op.add_column(
            "project_images", sa.Column("sharpness_score", sa.Float(), nullable=True)
        )

    # Create indexes if they don't exist
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_images_batch_id ON project_images (batch_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_project_images_batch_status ON project_images (batch_id, status)"
    )

    # Check if we need to update the enum
    # Get current enum type name
    enum_type_name = connection.execute(
        sa.text("""
        SELECT t.typname
        FROM pg_type t
        JOIN pg_class c ON c.reltype = t.oid
        WHERE c.relname = 'project_images'
        AND EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid
            AND a.attname = 'status'
            AND a.atttypid = t.oid
        )
        UNION
        SELECT t.typname
        FROM pg_type t
        JOIN pg_attribute a ON a.atttypid = t.oid
        JOIN pg_class c ON a.attrelid = c.oid
        WHERE c.relname = 'project_images'
        AND a.attname = 'status'
        LIMIT 1
    """)
    ).scalar()

    # Check if 'uploaded' value exists in the enum
    uploaded_exists = connection.execute(
        sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            WHERE t.typname IN ('imagestatus', 'image_status')
            AND e.enumlabel = 'uploaded'
        )
    """)
    ).scalar()

    if not uploaded_exists:
        # Need to recreate the enum with new values
        # First, drop the default
        op.execute("ALTER TABLE project_images ALTER COLUMN status DROP DEFAULT")

        # Rename old enum and create new one
        op.execute(f"ALTER TYPE {enum_type_name} RENAME TO {enum_type_name}_old")
        op.execute("""
            CREATE TYPE imagestatus AS ENUM (
                'staged',
                'uploaded',
                'classifying',
                'assigned',
                'rejected',
                'unmatched',
                'invalid_exif',
                'duplicate'
            )
        """)

        # Convert column to new type
        op.execute("""
            ALTER TABLE project_images
            ALTER COLUMN status TYPE imagestatus
            USING CASE status::text
                WHEN 'classified' THEN 'assigned'::imagestatus
                ELSE status::text::imagestatus
            END
        """)

        # Drop old enum and restore default
        op.execute(f"DROP TYPE {enum_type_name}_old")
        op.execute(
            "ALTER TABLE project_images ALTER COLUMN status SET DEFAULT 'staged'::imagestatus"
        )


def downgrade():
    op.drop_index("idx_project_images_batch_status", table_name="project_images")
    op.drop_index("idx_project_images_batch_id", table_name="project_images")
    op.drop_column("project_images", "sharpness_score")
    op.drop_column("project_images", "rejection_reason")
    op.drop_column("project_images", "batch_id")

    op.execute("ALTER TYPE imagestatus RENAME TO imagestatus_new")
    op.execute("""
        CREATE TYPE imagestatus AS ENUM (
            'staged',
            'classified',
            'invalid_exif',
            'unmatched',
            'duplicate'
        )
    """)
    op.execute("""
        ALTER TABLE project_images
        ALTER COLUMN status TYPE imagestatus
        USING CASE status::text
            WHEN 'uploaded' THEN 'staged'::imagestatus
            WHEN 'assigned' THEN 'classified'::imagestatus
            WHEN 'classifying' THEN 'staged'::imagestatus
            WHEN 'rejected' THEN 'staged'::imagestatus
            ELSE status::text::imagestatus
        END
    """)
    op.execute("DROP TYPE imagestatus_new")

    op.alter_column(
        "project_images",
        "status",
        existing_type=postgresql.ENUM(
            "staged",
            "classified",
            "invalid_exif",
            "unmatched",
            "duplicate",
            name="imagestatus",
        ),
        nullable=False,
        server_default="staged",
    )
