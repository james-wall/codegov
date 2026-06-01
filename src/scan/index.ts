import { getCommitLog, getCommitDetail } from "../git/parser.js";
import { detectAgent, isBrandedAgent } from "../detect/engine.js";
import { ProvenanceRecord, ScanResult, StatsResult } from "../types.js";
import { appendRecord, readRecords } from "./store.js";

export function scanHistory(
  since?: string,
  path?: string,
  opts: { includeGeneric?: boolean; noStat?: boolean } = {}
): ScanResult {
  const includeGeneric = opts.includeGeneric ?? false;
  const commits = getCommitLog({ since, path, noStat: opts.noStat });
  const commitHashes = new Set(commits.map(c => c.hash));
  const existingRecords = readRecords();
  const existingHashes = new Set(existingRecords.map(r => r.commitHash));

  const records: ProvenanceRecord[] = [];

  for (const commit of commits) {
    if (existingHashes.has(commit.hash)) continue;

    const detection = detectAgent(commit);
    // Persist only what we count: branded tools always; generic ("unknown-ai")
    // only when explicitly opted in via --include-generic.
    if (
      detection.confidence > 0.3 &&
      (isBrandedAgent(detection.agentId) || includeGeneric)
    ) {
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

  // All AI records in the scan window (new + previously stored), filtered to the
  // same count policy so a pre-existing store containing generic hits can't
  // inflate the default branded-only headline.
  const allInRange = [
    ...records,
    ...existingRecords.filter(
      r =>
        commitHashes.has(r.commitHash) &&
        (isBrandedAgent(r.agentId) || includeGeneric)
    ),
  ];

  return {
    totalCommits: commits.length,
    aiCommits: allInRange.length,
    newRecords: records.length,
    records,
    allInRange,
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

export function computeStats(opts: { includeGeneric?: boolean } = {}): StatsResult {
  const includeGeneric = opts.includeGeneric ?? false;
  const commits = getCommitLog();
  const commitHashes = new Set(commits.map(c => c.hash));

  // Scope stored records to commits actually reachable from HEAD (and to the
  // count policy). Without the reachability filter, records from other branches
  // or earlier path-scoped scans could exceed the commit count and push the
  // percentage over 100%.
  const records = readRecords().filter(
    r =>
      commitHashes.has(r.commitHash) &&
      (isBrandedAgent(r.agentId) || includeGeneric)
  );

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
