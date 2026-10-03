"""One SQLite file holds the slice; WAL lets the fetchers write in parallel."""
import sqlite3

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT, model_string TEXT);
CREATE TABLE IF NOT EXISTS goals (goal TEXT, start_time TEXT, end_time TEXT);
CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS chat (
  id TEXT PRIMARY KEY, speaker_type TEXT, agent_id TEXT, content TEXT, room_id TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS summaries (
  id TEXT PRIMARY KEY, type TEXT, target TEXT, summary_date TEXT, content TEXT,
  generated_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, agent_id TEXT, session_goal TEXT, created_at TEXT);
-- Evidence lives in action/output/error/screenshot. narration and thinking are the agent's own
-- words: kept for context, never counted as a receipt.
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY, session_id TEXT, agent_id TEXT, created_at TEXT,
  action TEXT, output TEXT, error TEXT, system TEXT,
  redacted INTEGER, overruled INTEGER,
  tool_calls TEXT, narration TEXT, thinking TEXT);
CREATE INDEX IF NOT EXISTS turns_agent_time ON turns (agent_id, created_at);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, agent_id TEXT, created_at TEXT, content TEXT);
CREATE INDEX IF NOT EXISTS memories_agent_time ON memories (agent_id, created_at);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, event_index INTEGER, created_at TEXT, action_type TEXT,
  agent_id TEXT, message_id TEXT, data TEXT);
CREATE INDEX IF NOT EXISTS events_type ON events (action_type, created_at);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=300)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.executescript(SCHEMA)
    return con
