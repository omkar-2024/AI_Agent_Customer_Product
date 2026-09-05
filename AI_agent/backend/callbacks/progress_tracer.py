from __future__ import annotations

from typing import Any, Callable
from langchain_core.callbacks import BaseCallbackHandler


class ProgressTracer(BaseCallbackHandler):
    """Send concise agent progress events to the web client."""

    def __init__(self, emit: Callable[[str], None]):
        self.emit = emit

    def on_llm_start(self, serialized: dict[str, Any], prompts: list[str], **kwargs: Any) -> None:
        self.emit("Understanding your question")

    def on_tool_start(self, serialized: dict[str, Any], input_str: str, **kwargs: Any) -> None:
        name = serialized.get("name", "")
        labels = {
            "db_catalog_viewer": "Checking available data tables",
            "db_schema_viewer": "Checking database schema",
            "sql_query_validator": "Validating the database query",
            "sql_runner_client": "Running the database query",
            "send_emails": "Preparing the requested email",
            "generate_report_document": "Generating your report document",
            "visualise_query_result": "Creating your chart visualization",
        }
        self.emit(labels.get(name, "Working on your request"))

    def on_tool_end(self, output: Any, **kwargs: Any) -> None:
        return None

    def on_tool_error(self, error: Exception, **kwargs: Any) -> None:
        self.emit("A tool encountered an issue")

    def on_llm_error(self, error: Exception, **kwargs: Any) -> None:
        self.emit("Finishing with an error")
