"""LLM model factory.

get_model(model_type) returns a cached BaseChatModel for the given type string.
is_claude(model_type) returns True for every type that routes to a Claude instance.

Adding a new provider: add a branch in _build() and register it here.
"""

from langchain_core.language_models import BaseChatModel

_registry: dict[str, BaseChatModel] = {}


def get_model(model_type: str | None) -> BaseChatModel:
    key = model_type or "glyph"
    if key not in _registry:
        _registry[key] = _build(key)
    return _registry[key]


def is_claude(model_type: str | None) -> bool:
    return (model_type or "glyph") not in ("openai", "gemini")


def _build(key: str) -> BaseChatModel:
    from settings import get_settings
    s = get_settings()

    if key == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model="gpt-4o", api_key=s.openai_api_key, streaming=True)
    elif key == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model="gemini-2.0-flash", google_api_key=s.google_api_key, streaming=True)
    else:
        # anthropic, glyph, glyph_* specialists, or any unrecognised type → Claude
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model="claude-sonnet-4-6",
            api_key=s.anthropic_api_key,
            streaming=True,
            thinking={"type": "enabled", "budget_tokens": 8000},
            max_tokens=16000,
        )
