"""Merge add_project_odm_metadata and rename_output_raw_url heads

Revision ID: merge_odm_metadata_and_output_urls
Revises: add_project_odm_metadata, rename_output_raw_url
Create Date: 2026-05-05

"""

from typing import Sequence, Union


revision: str = "merge_odm_metadata_and_output_urls"
down_revision: Union[str, tuple] = ("add_project_odm_metadata", "rename_output_raw_url")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
