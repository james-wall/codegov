import Database from "better-sqlite3";
import path from "path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tool_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool TEXT NOT NULL,
  developer TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  file_path TEXT,
  lines_added INTEGER DEFAULT 0,
  lines_removed INTEGER DEFAULT 0,
  model TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  session_id TEXT,
  raw_span TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT UNIQUE NOT NULL,
  author TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  repo TEXT,
  branch TEXT,
  message TEXT,
  total_additions INTEGER DEFAULT 0,
  total_deletions INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commit_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_hash TEXT NOT NULL,
  file_path TEXT NOT NULL,
  additions INTEGER DEFAULT 0,
  deletions INTEGER DEFAULT 0,
  FOREIGN KEY (commit_hash) REFERENCES commits(hash)
);

CREATE TABLE IF NOT EXISTS attributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_hash TEXT NOT NULL,
  tool_event_id INTEGER NOT NULL,
  tool TEXT NOT NULL,
  developer TEXT NOT NULL,
  file_path TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium',
  method TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (commit_hash) REFERENCES commits(hash),
  FOREIGN KEY (tool_event_id) REFERENCES tool_events(id)
);

CREATE INDEX IF NOT EXISTS idx_tool_events_developer ON tool_events(developer);
CREATE INDEX IF NOT EXISTS idx_tool_events_timestamp ON tool_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_events_file ON tool_events(file_path);
CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author);
CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits(timestamp);
CREATE INDEX IF NOT EXISTS idx_commit_files_hash ON commit_files(commit_hash);
CREATE INDEX IF NOT EXISTS idx_commit_files_path ON commit_files(file_path);
CREATE INDEX IF NOT EXISTS idx_attributions_commit ON attributions(commit_hash);
`;

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath ?? path.join(process.cwd(), "codegov.db");
  db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
