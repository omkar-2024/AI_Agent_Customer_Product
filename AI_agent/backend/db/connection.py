import os
import threading
from contextlib import contextmanager

from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
# Dedicated least-privilege, read-only role connection (falls back to DATABASE_URL if unset)
READONLY_DATABASE_URL = os.getenv("READONLY_DATABASE_URL", DATABASE_URL)
DB_POOL_MIN = max(1, int(os.getenv("DB_POOL_MIN", "1")))
DB_POOL_MAX = max(DB_POOL_MIN, int(os.getenv("DB_POOL_MAX", "5")))

_pools: dict[str, ThreadedConnectionPool] = {}
_pool_lock = threading.Lock()


def _get_pool(database_url: str | None) -> ThreadedConnectionPool:
    if not database_url:
        raise RuntimeError("Database connection URL is not configured.")

    pool = _pools.get(database_url)
    if pool is not None:
        return pool

    with _pool_lock:
        pool = _pools.get(database_url)
        if pool is None:
            pool = ThreadedConnectionPool(
                DB_POOL_MIN,
                DB_POOL_MAX,
                dsn=database_url,
                cursor_factory=RealDictCursor,
            )
            _pools[database_url] = pool
        return pool


@contextmanager
def _pooled_connection(database_url: str | None):
    pool = _get_pool(database_url)
    conn = pool.getconn()
    try:
        yield conn
        if not conn.closed:
            conn.commit()
    except Exception:
        if not conn.closed:
            conn.rollback()
        raise
    finally:
        pool.putconn(conn, close=bool(conn.closed))


def get_connection():
    return _pooled_connection(DATABASE_URL)


def get_readonly_connection():
    return _pooled_connection(READONLY_DATABASE_URL)
