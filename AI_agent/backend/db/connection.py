import os
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import RealDictCursor

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
# Dedicated least-privilege, read-only role connection (falls back to DATABASE_URL if unset)
READONLY_DATABASE_URL = os.getenv("READONLY_DATABASE_URL", DATABASE_URL)


def get_connection():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def get_readonly_connection():
    return psycopg2.connect(READONLY_DATABASE_URL, cursor_factory=RealDictCursor)
