import json

import psycopg2
from psycopg2.extras import RealDictCursor
from langchain_core.tools import tool
from db.connection import get_readonly_connection
from tools.sql_query_validator import validate_select_query

@tool
def sql_runner_client(query: str) -> str:
    """Executes a validated read-only SQL query against the database and returns JSON formatted rows."""
    # Enforced here, not just relied on via the system prompt - the LLM must never
    # be able to skip validation by calling this tool directly.
    is_valid, message = validate_select_query(query)
    if not is_valid:
        return f"Query rejected before execution: {message}"

    try:
        with get_readonly_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Set a hard 5-second statement timeout to prevent long-running locks
                cur.execute("SET STATEMENT_TIMEOUT = 5000;")
                cur.execute(query)
                results = cur.fetchall()
                
                # Convert RealDictCursor rows into standard Python dictionary list
                return json.dumps(
                    [dict(row) for row in results],
                    default=str,
                )
                
    except psycopg2.Error as e:
        return f"Database Execution Error: {e.pgerror or str(e)}"
    except Exception as e:
        return f"Execution Failure: {str(e)}"
