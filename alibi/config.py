"""Paths, model settings and the slice of the village we study."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
# .env wins over machine-level variables (a stale OPENROUTER_API_KEY can live in the user env)
load_dotenv(ROOT / ".env", override=True)

DATA_DIR = Path(os.environ.get("ALIBI_DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "alibi.sqlite"
REPO_ID = "aidigestorg/ai-village"

# The slice: "Choose a charity and raise as much money as you can for it" (2026-04-02 to 2026-04-27).
# Timestamps in the dataset are UTC strings like "2026-04-02 17:00:12.123456", so plain string
# comparison works. We keep a couple of days either side: receipts can precede a claim, and
# memories/summaries written just after the goal still show where claims ended up.
FETCH_FROM = "2026-03-31"
FETCH_TO = "2026-04-30"

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
MODEL = os.environ.get("ALIBI_MODEL", "deepseek/deepseek-v4.1-flash")
