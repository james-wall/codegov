import { getDb } from "./schema.js";

export interface ToolEventInsert {
  tool: string;
  developer: string;
  timestamp: string;
  event_type: string;
  file_path?: string;
  lines_added?: number;
  lines_removed?: number;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  session_id?: string;
  raw_span?: string;
}

export interface CommitInsert {
  hash: string;
  author: string;
  timestamp: string;
  repo?: string;
  branch?: string;
  message?: string;
  total_additions?: number;
  total_deletions?: number;
  files: Array<{ path: string; additions: number; deletions: number }>;
}

export function insertToolEvent(event: ToolEventInsert): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO tool_events (tool, developer, timestamp, event_type, file_path,
      lines_added, lines_removed, model, tokens_in, tokens_out, cost_usd, session_id, raw_span)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    event.tool, event.developer, event.timestamp, event.event_type,
    event.file_path ?? null, event.lines_added ?? 0, event.lines_removed ?? 0,
    event.model ?? null, event.tokens_in ?? 0, event.tokens_out ?? 0,
    event.cost_usd ?? 0, event.session_id ?? null, event.raw_span ?? null,
  );

  return Number(result.lastInsertRowid);
}

export function insertCommit(commit: CommitInsert): void {
  const db = getDb();

  const commitStmt = db.prepare(`
    INSERT OR IGNORE INTO commits (hash, author, timestamp, repo, branch, message, total_additions, total_deletions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const fileStmt = db.prepare(`
    INSERT INTO commit_files (commit_hash, file_path, additions, deletions)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    commitStmt.run(
      commit.hash, commit.author, commit.timestamp,
      commit.repo ?? null, commit.branch ?? null, commit.message ?? null,
      commit.total_additions ?? 0, commit.total_deletions ?? 0,
    );

    for (const file of commit.files) {
      fileStmt.run(commit.hash, file.path, file.additions, file.deletions);
    }
  });

  transaction();
}

function insertAttribution(attr: {
  commit_hash: string;
  tool_event_id: number;
  tool: string;
  developer: string;
  file_path?: string;
  confidence: "high" | "medium" | "low";
  method: string;
}): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO attributions (commit_hash, tool_event_id, tool, developer, file_path, confidence, method)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(attr.commit_hash, attr.tool_event_id, attr.tool, attr.developer,
    attr.file_path ?? null, attr.confidence, attr.method);
}

const DEFAULT_WINDOW_MINUTES = 30;

export function correlateCommit(commitHash: string, windowMinutes = DEFAULT_WINDOW_MINUTES): void {
  const db = getDb();

  const commit = db.prepare("SELECT * FROM commits WHERE hash = ?").get(commitHash) as {
    hash: string; author: string; timestamp: string;
  } | undefined;

  if (!commit) return;

  const commitFiles = db.prepare("SELECT * FROM commit_files WHERE commit_hash = ?").all(commitHash) as Array<{
    file_path: string; additions: number; deletions: number;
  }>;

  for (const file of commitFiles) {
    const matchingEvents = db.prepare(`
      SELECT id, tool, developer, file_path FROM tool_events
      WHERE developer = ?
        AND file_path = ?
        AND datetime(timestamp) BETWEEN datetime(?, '-${windowMinutes} minutes') AND datetime(?)
      ORDER BY timestamp DESC
    `).all(commit.author, file.file_path, commit.timestamp, commit.timestamp) as Array<{
      id: number; tool: string; developer: string; file_path: string;
    }>;

    if (matchingEvents.length === 0) continue;

    const confidence = matchingEvents.length === 1 ? "high" : "low";

    for (const event of matchingEvents) {
      insertAttribution({
        commit_hash: commitHash,
        tool_event_id: event.id,
        tool: event.tool,
        developer: event.developer,
        file_path: file.file_path,
        confidence,
        method: "file_time_window",
      });
    }
  }
}

export interface DashboardMetrics {
  totalEvents: number;
  totalCommits: number;
  totalAttributions: number;
  eventsByTool: Array<{ tool: string; count: number }>;
  recentEvents: Array<{
    id: number; tool: string; developer: string; timestamp: string;
    event_type: string; file_path: string | null;
  }>;
  recentCommits: Array<{
    hash: string; author: string; timestamp: string; message: string | null;
    total_additions: number; total_deletions: number;
  }>;
  attributionsByTool: Array<{ tool: string; confidence: string; count: number }>;
  devActivity: Array<{ developer: string; events: number; commits: number }>;
}

export function getDashboardMetrics(days = 30): DashboardMetrics {
  const db = getDb();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const totalEvents = (db.prepare(
    "SELECT COUNT(*) as count FROM tool_events WHERE timestamp >= ?"
  ).get(since) as { count: number }).count;

  const totalCommits = (db.prepare(
    "SELECT COUNT(*) as count FROM commits WHERE timestamp >= ?"
  ).get(since) as { count: number }).count;

  const totalAttributions = (db.prepare(
    "SELECT COUNT(*) as count FROM attributions WHERE created_at >= ?"
  ).get(since) as { count: number }).count;

  const eventsByTool = db.prepare(`
    SELECT tool, COUNT(*) as count FROM tool_events
    WHERE timestamp >= ? GROUP BY tool ORDER BY count DESC
  `).all(since) as Array<{ tool: string; count: number }>;

  const recentEvents = db.prepare(`
    SELECT id, tool, developer, timestamp, event_type, file_path
    FROM tool_events ORDER BY timestamp DESC LIMIT 20
  `).all() as DashboardMetrics["recentEvents"];

  const recentCommits = db.prepare(`
    SELECT hash, author, timestamp, message, total_additions, total_deletions
    FROM commits ORDER BY timestamp DESC LIMIT 20
  `).all() as DashboardMetrics["recentCommits"];

  const attributionsByTool = db.prepare(`
    SELECT tool, confidence, COUNT(*) as count FROM attributions
    WHERE created_at >= ? GROUP BY tool, confidence ORDER BY count DESC
  `).all(since) as Array<{ tool: string; confidence: string; count: number }>;

  const devActivity = db.prepare(`
    SELECT developer, COUNT(*) as events, 0 as commits FROM tool_events
    WHERE timestamp >= ? GROUP BY developer
  `).all(since) as Array<{ developer: string; events: number; commits: number }>;

  const commitCounts = db.prepare(`
    SELECT author as developer, COUNT(*) as commits FROM commits
    WHERE timestamp >= ? GROUP BY author
  `).all(since) as Array<{ developer: string; commits: number }>;

  const commitMap = new Map(commitCounts.map(c => [c.developer, c.commits]));
  for (const dev of devActivity) {
    dev.commits = commitMap.get(dev.developer) ?? 0;
  }

  return {
    totalEvents, totalCommits, totalAttributions,
    eventsByTool, recentEvents, recentCommits,
    attributionsByTool, devActivity,
  };
}
