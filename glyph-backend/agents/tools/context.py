"""Per-request tool state shared across all context-aware tools in one agent run."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Delegation:
    """A queued handoff produced by the delegate tool during one agent run."""
    target_llm_id: str
    target_name: str
    task: str
    message_id: str | None = None


@dataclass
class ToolContext:
    chat_id: str
    sender_llm_id: str
    # Normalized display_name -> invited_llms.id, excluding sender
    other_llms_by_name: dict[str, str]
    delegations: list[Delegation] = field(default_factory=list)
    # Shared Python namespace across python_repl calls within one agent run
    repl_namespace: dict = field(default_factory=dict)
