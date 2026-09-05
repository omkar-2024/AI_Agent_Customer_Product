from langchain_core.tools import tool
from sqlglot import parse_one, exp, ParseError


def validate_select_query(query: str) -> tuple[bool, str]:
    """Core validation logic - reused directly by sql_runner_client so validation
    can never be skipped, regardless of what the LLM decides to call."""
    try:
        parsed = parse_one(query, dialect="postgres")
    except ParseError as e:
        return False, f"Invalid SQL syntax. Details: {str(e)}"
    except Exception as e:
        return False, f"Unable to parse query. Error: {str(e)}"

    if not isinstance(parsed, exp.Select):
        return False, "Only read-only SELECT statements are allowed."

    # Postgres allows data-modifying statements inside a WITH (CTE) clause, e.g.
    # "WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x" still parses as
    # a top-level SELECT, so the whole tree must be scanned, not just the top node.
    if parsed.find(exp.Insert) or parsed.find(exp.Update) or parsed.find(exp.Delete):
        return False, "Query contains a nested data-modifying statement (INSERT/UPDATE/DELETE)."

    return True, "Query is syntactically valid."


@tool
def sql_query_validator(query: str) -> str:
    """Validates if a SQL query is syntactically valid and strictly a SELECT statement."""
    is_valid, message = validate_select_query(query)
    return f"Validation Passed: {message}" if is_valid else f"Validation Failed: {message}"