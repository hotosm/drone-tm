from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


ALEMBIC_VERSION_NUM_MAX_LENGTH = 32
BACKEND_DIR = Path(__file__).resolve().parents[1]


def _migration_script() -> ScriptDirectory:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "app/migrations"))
    return ScriptDirectory.from_config(config)


def test_alembic_has_single_head():
    assert len(_migration_script().get_heads()) == 1


def test_alembic_revision_ids_fit_version_table():
    too_long = sorted(
        revision.revision
        for revision in _migration_script().walk_revisions()
        if len(revision.revision) > ALEMBIC_VERSION_NUM_MAX_LENGTH
    )

    assert too_long == []
