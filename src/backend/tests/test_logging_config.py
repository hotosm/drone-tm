import logging

from app.main import get_logger


def test_get_logger_suppresses_psycopg_pool_info_logs():
    """
    psycopg_pool gives very verbose logs we wish to suppress.
    """
    psycopg_pool_logger = logging.getLogger("psycopg.pool")
    psycopg_pool_logger.setLevel(logging.INFO)
    psycopg_pool_logger.handlers = [logging.NullHandler()]

    get_logger()

    assert psycopg_pool_logger.level == logging.WARNING
    assert psycopg_pool_logger.handlers == []
