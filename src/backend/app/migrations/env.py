from logging import getLogger

from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from app.db.db_models import Base
from alembic import context
from app.config import settings

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.

config = context.config
config.set_main_option("sqlalchemy.url", settings.DTM_DB_URL.unicode_string())


if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = Base.metadata
exclude_tables = config.get_section("alembic:exclude").get("tables", "").split(",")

log = getLogger(__name__)

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


# def include_object(object, name, type_, reflected, compare_to):
#     """Ignore our excluded tables in the autogen sweep."""
#     if type_ == "table" and name in exclude_tables:
#         return False
#     else:
#         return alembic_helpers.include_object(
#             object, name, type_, reflected, compare_to
#         )


def include_name(name, type_, parent_names):
    if type_ == "schema":
        return name in [None, "public"]
    elif type_ == "table":
        # use schema_qualified_table_name directly
        return parent_names["schema_qualified_table_name"] in target_metadata.tables
    else:
        return True


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    log.info("Running offline migrations")

    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        # include_object=include_object,
        include_name=include_name,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

    log.info("Complete offline migrations")


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    log.info("Running online migrations")

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            # include_object=include_object,
            include_name=include_name,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()

    log.info("Complete online migrations")


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
