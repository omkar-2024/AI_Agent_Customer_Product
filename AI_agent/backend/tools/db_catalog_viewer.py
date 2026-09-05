from langchain_core.tools import tool

from db.connection import get_connection


@tool
def db_catalog_viewer() -> list[str]:
    """Returns the list of all table names available in the public schema of the database."""
    query = """
        select table_name
        from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name;
    """
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(query)
        rows = cur.fetchall()
    return [row["table_name"] for row in rows]
