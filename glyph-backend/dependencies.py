"""Client singletons — constructed once, importable anywhere.

settings.py holds config values (pure data).
This module turns them into live clients, cached with lru_cache so each
process shares one connection pool per client type.

Usage outside FastAPI (agents, tools):
    from dependencies import get_supabase, get_openai

Usage inside FastAPI routes (for DI override in tests):
    from fastapi import Depends
    from dependencies import get_supabase
    def my_route(db = Depends(get_supabase)): ...
"""

from functools import lru_cache

import httpx
import jwt
from openai import OpenAI
from supabase import Client, ClientOptions, create_client

from settings import get_settings


@lru_cache
def get_supabase() -> Client:
    s = get_settings()
    return create_client(
        s.supabase_url,
        s.supabase_service_key,
        options=ClientOptions(
            httpx_client=httpx.Client(
                http2=False,
                limits=httpx.Limits(max_keepalive_connections=5, keepalive_expiry=30),
            )
        ),
    )


@lru_cache
def get_openai() -> OpenAI:
    return OpenAI(api_key=get_settings().openai_api_key)


@lru_cache
def get_jwks_client() -> jwt.PyJWKClient:
    s = get_settings()
    return jwt.PyJWKClient(f"{s.supabase_url}/auth/v1/.well-known/jwks.json")
