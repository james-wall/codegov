import { getCommitLog, getCommitDetail } from "../git/parser.js";
import { detectAgent } from "../detect/engine.js";
import { ProvenanceRecord, ScanResult, StatsResult } from "../types.js";
import { appendRecord, readRecords } from "./store.js";

export function scanHistory(since?: string, path?: string): ScanResult {
  const commits = getCommitLog(since, path);
  const existing = new Set(readRecords().map(r => r.commitHash));
  const records: ProvenanceRecord[] = [];

  for (const commit of commits) {
    if (existing.has(commit.hash)) continue;

    const detection = detectAgent(commit);
    if (detection.confidence > 0.3) {
      const record: ProvenanceRecord = {
        commitHash: commit.hash,
        timestamp: commit.timestamp,
        agentId: detection.agentId,
        modelVersion: detection.modelVersion,
        promptSummary: detection.promptSummary,
        filesChanged: commit.filesChanged,
        linesAdded: commit.linesAdded,
        linesRemoved: commit.linesRemoved,
        reviewStatus: "unreviewed",
        reviewer: null,
        confidence: detection.confidence,
        signals: detection.signals,
      };
      records.push(record);
      appendRecord(record);
    }
  }

  return {
    totalCommits: commits.length,
    aiCommits: records.length + existing.size,
    newRecords: records.length,
    records,
  };
}

export function forensics(hash: string): ProvenanceRecord | null {
  const stored = readRecords().find((r) => r.commitHash === hash);
  if (stored) return stored;

  const commit = getCommitDetail(hash);
  if (!commit) return null;

  const detection = detectAgent(commit);
  return {
    commitHash: commit.hash,
    timestamp: commit.timestamp,
    agentId: detection.agentId,
    modelVersion: detection.modelVersion,
    promptSummary: detection.promptSummary,
    filesChanged: commit.filesChanged,
    linesAdded: commit.linesAdded,
    linesRemoved: commit.linesRemoved,
    reviewStatus: "unreviewed",
    reviewer: null,
    confidence: detection.confidence,
    signals: detection.signals,
  };
}

export function computeStats(): StatsResult {
  const records = readRecords();
  const commits = getCommitLog();

  const byAgent: Record<string, number> = {};
  const byMonth: Record<string, { total: number; ai: number }> = {};

  for (const record of records) {
    byAgent[record.agentId] = (byAgent[record.agentId] || 0) + 1;
  }

  for (const commit of commits) {
    const month = commit.timestamp.slice(0, 7);
    if (!byMonth[month]) {
      byMonth[month] = { total: 0, ai: 0 };
    }
    byMonth[month].total++;
  }

  for (const record of records) {
    const month = record.timestamp.slice(0, 7);
    if (byMonth[month]) {
      byMonth[month].ai++;
    }
  }

  const aiCommits = records.length;
  const totalCommits = commits.length;

  return {
    totalCommits,
    aiCommits,
    aiPercentage: totalCommits > 0 ? (aiCommits / totalCommits) * 100 : 0,
    byAgent,
    byMonth,
  };
}
