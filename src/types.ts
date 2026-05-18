export type AgentId =
  | "claude-code"
  | "cursor"
  | "copilot"
  | "devin"
  | "aider"
  | "unknown-ai"
  | "human";

export type ReviewStatus = "unreviewed" | "approved" | "modified";

export interface ProvenanceRecord {
  commitHash: string;
  timestamp: string;
  agentId: AgentId;
  modelVersion: string | null;
  promptSummary: string | null;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  reviewStatus: ReviewStatus;
  reviewer: string | null;
  confidence: number;
  signals: string[];
}

export interface ScanResult {
  totalCommits: number;
  aiCommits: number;
  newRecords: number;
  records: ProvenanceRecord[];
  allInRange: ProvenanceRecord[];
}

export interface StatsResult {
  totalCommits: number;
  aiCommits: number;
  aiPercentage: number;
  byAgent: Record<string, number>;
  byMonth: Record<string, { total: number; ai: number }>;
}

export type Tool = "copilot" | "cursor" | "claude-code";

export interface ToolUsageRecord {
  developer: string;
  tool: Tool;
  date: string;
  suggestions: number;
  acceptedLines: number;
  rejectedLines: number;
  costUsd: number;
}

export interface TeamMapping {
  [team: string]: string[];
}

export interface DevMetrics {
  developer: string;
  tool: string;
  totalSpend: number;
  totalSuggestions: number;
  totalAcceptedLines: number;
  totalRejectedLines: number;
  acceptanceRate: number;
  days: number;
}

export interface ToolComparison {
  tool: Tool;
  totalSpend: number;
  totalAcceptedLines: number;
  costPerLine: number;
  acceptanceRate: number;
  devCount: number;
}

export interface TeamMetrics {
  team: string;
  totalSpend: number;
  totalAcceptedLines: number;
  totalRejectedLines: number;
  acceptanceRate: number;
  avgSpendPerDev: number;
  devCount: number;
}

export interface Anomaly {
  developer: string;
  team: string;
  tool: string;
  spend: number;
  teamMean: number;
  teamStdDev: number;
  deviations: number;
}

export interface PRRecord {
  number: number;
  author: string;
  mergedAt: string | null;
}
