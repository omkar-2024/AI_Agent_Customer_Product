from langchain_core.tools import tool
from db.connection import get_connection


@tool
def db_schema_viewer(table_name: str) -> list[dict]:
    """Returns the column names and data types for the specified table in the public schema."""
    query = """
        select column_name, data_type
        from information_schema.columns
        where table_schema = 'public' and table_name = %s
        order by ordinal_position;
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(query, (table_name,))
        rows = cur.fetchall()
    return [dict(row) for row in rows]
