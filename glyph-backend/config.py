"""Shared singletons: env loading, OpenAI client, Supabase client, JWKS client.

Imported by every other module. Living here (instead of main.py) means no
circular-import dance — invitations.py and the agents can import these directly.
"""

import os
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client
import jwt


load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


PDFS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfs")
CHARTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "charts")
FILES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "files")
os.makedirs(PDFS_DIR, exist_ok=True)
os.makedirs(CHARTS_DIR, exist_ok=True)
os.makedirs(FILES_DIR, exist_ok=True)


supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_KEY"),
)

jwks_client = jwt.PyJWKClient(f"{os.getenv('SUPABASE_URL')}/auth/v1/.well-known/jwks.json")

openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def setup_tracing() -> None:
    """Log whether LangSmith tracing is on. Auto-instrumentation kicks in
    purely from the LANGSMITH_* env vars once langchain is installed — this
    function is just a startup signal."""
    if os.getenv("LANGSMITH_TRACING", "").lower() == "true":
        project = os.getenv("LANGSMITH_PROJECT", "(default)")
        print(f"[langsmith] tracing on, project={project}")
    else:
        print("[langsmith] tracing off")
