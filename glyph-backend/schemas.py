"""Pydantic models — request bodies and structured response shapes.

Kept in one place so route handlers and agent modules share the same types.
"""

from pydantic import BaseModel, Field


class AttachmentInfo(BaseModel):
    url: str
    mime_type: str
    filename: str
    size: int = 0


class AskLLMRequest(BaseModel):
    chat_id: str
    llm_id: str
    side_message_id: str | None = None
    # When set, the agent regenerates the existing message in place: context
    # is truncated to messages strictly BEFORE this id, and the final answer
    # is UPDATEd onto this row instead of inserted as a new one.
    replace_message_id: str | None = None


class PlanAgentRequest(BaseModel):
    chat_id: str


class PlanItem(BaseModel):
    """One step in the planner's ordered execution plan."""
    date: str = Field(
        default="",
        description="Date this task belongs to, formatted as YYYY-MM-DD.",
    )
    task: str = Field(
        description="Exact task text from the markdown, without the leading `- [ ]` checkbox.",
    )
    depends_on: list[str] = Field(
        default_factory=list,
        description="Exact texts of prerequisite tasks, if any. Empty list if none.",
    )
    rationale: str = Field(
        default="",
        description="One short sentence explaining why this task is at this position in the plan.",
    )


class PlannerResponse(BaseModel):
    """Final structured output of the planner agent."""
    summary: str = Field(
        default="",
        description="One sentence describing the overall plan.",
    )
    plan: list[PlanItem] = Field(
        default_factory=list,
        description="Tasks in execution order — dependencies respected, ready tasks first.",
    )
