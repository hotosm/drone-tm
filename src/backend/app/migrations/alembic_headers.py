"""Helpers for alembic migrate and downgrade."""

from alembic import op
from sqlalchemy import engine_from_config
from sqlalchemy.engine import reflection


def table_does_not_exist(table, schema=None):
    """Handle tables that do not exist."""
    config = op.get_context().config
    engine = engine_from_config(
        config.get_section(config.config_ini_section), prefix="sqlalchemy."
    )
    insp = reflection.Inspector.from_engine(engine)
    return insp.has_table(table, schema) is False


def table_has_column(table, column):
    """Handle tables when column already exists."""
    config = op.get_context().config
    engine = engine_from_config(
        config.get_section(config.config_ini_section), prefix="sqlalchemy."
    )
    insp = reflection.Inspector.from_engine(engine)
    has_column = False
    for col in insp.get_columns(table):
        if column not in col["name"]:
            continue
        has_column = True
    return has_column
