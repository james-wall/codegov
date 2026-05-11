import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ProvenanceRecord } from "../types.js";

function getRepoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
}

function getLogPath(): string {
  const root = getRepoRoot();
  return join(root, ".codegov", "events.jsonl");
}

export function ensureStoreExists(): void {
  const logPath = getLogPath();
  const dir = join(logPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(logPath)) {
    writeFileSync(logPath, "");
  }
}

export function appendRecord(record: ProvenanceRecord): void {
  ensureStoreExists();
  const logPath = getLogPath();
  const line = JSON.stringify(record) + "\n";
  writeFileSync(logPath, line, { flag: "a" });
}

export function writeRecords(records: ProvenanceRecord[]): void {
  ensureStoreExists();
  const logPath = getLogPath();
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(logPath, content);
}

export function readRecords(): ProvenanceRecord[] {
  const logPath = getLogPath();
  if (!existsSync(logPath)) return [];

  const content = readFileSync(logPath, "utf-8");
  const all = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ProvenanceRecord);

  // Deduplicate by commit hash, keeping the latest entry
  const seen = new Map<string, ProvenanceRecord>();
  for (const r of all) {
    seen.set(r.commitHash, r);
  }
  return Array.from(seen.values());
}

export function queryRecords(opts: {
  path?: string;
  agent?: string;
  since?: string;
}): ProvenanceRecord[] {
  let records = readRecords();

  if (opts.path) {
    records = records.filter((r) =>
      r.filesChanged.some((f) => f.startsWith(opts.path!))
    );
  }

  if (opts.agent) {
    records = records.filter((r) => r.agentId === opts.agent);
  }

  if (opts.since) {
    const sinceDate = parseSinceDate(opts.since);
    if (sinceDate) {
      records = records.filter((r) => new Date(r.timestamp) >= sinceDate);
    }
  }

  return records;
}

function parseSinceDate(since: string): Date | null {
  const match = since.match(/^(\d+)([dhm])$/);
  if (!match) {
    const date = new Date(since);
    return isNaN(date.getTime()) ? null : date;
  }

  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case "d":
      now.setDate(now.getDate() - value);
      break;
    case "h":
      now.setHours(now.getHours() - value);
      break;
    case "m":
      now.setMonth(now.getMonth() - value);
      break;
  }

  return now;
}
