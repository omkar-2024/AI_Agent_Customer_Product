import json
from typing import Any, Dict, List
from langchain_core.callbacks import BaseCallbackHandler

class TerminalTracer(BaseCallbackHandler):
    """Custom callback handler for live color-coded terminal tracking."""

    # ANSI Color Codes
    BLUE = "\033[94m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    GRAY = "\033[90m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

    def on_llm_start(self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any) -> None:
        print(f"{self.CYAN}--------------------------------------------------{self.RESET}")
        print(f"{self.BLUE}⚡ [LLM CALL]{self.RESET} Sending request to LLM...")

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        print(f"{self.GREEN}✔ [LLM COMPLETED]{self.RESET} Received response from LLM.")

    def on_tool_start(self, serialized: Dict[str, Any], input_str: str, **kwargs: Any) -> None:
        tool_name = serialized.get("name", "Unknown Tool")
        print(f"\n{self.YELLOW}🛠 [TOOL EXECUTING]{self.RESET} {self.BOLD}{tool_name}{self.RESET}")
        print(f"  {self.GRAY}Input Payload:{self.RESET} {input_str}")

    def on_tool_end(self, output: Any, **kwargs: Any) -> None:
        print(f"{self.GREEN}✔ [TOOL FINISHED]{self.RESET}")
        print(f"  {self.GRAY}Output Observation:{self.RESET} {output}")
        print(f"{self.CYAN}--------------------------------------------------{self.RESET}\n")

    def on_tool_error(self, error: Exception, **kwargs: Any) -> None:
        print(f"{self.RED}✖ [TOOL ERROR]{self.RESET} {str(error)}")
        print(f"{self.CYAN}--------------------------------------------------{self.RESET}\n")