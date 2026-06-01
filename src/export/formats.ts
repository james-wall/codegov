import { readRecords } from "../scan/store.js";
import { ProvenanceRecord } from "../types.js";
import { execFileSync } from "node:child_process";
import { expandSince } from "../git/parser.js";
import { isBrandedAgent } from "../detect/engine.js";
import { VERSION } from "../version.js";

export interface AuditReport {
  generatedAt: string;
  repository: string;
  period: { from: string; to: string };
  summary: {
    totalCommits: number;
    aiAuthoredCommits: number;
    aiAuthoredPercentage: number;
    agentBreakdown: Record<string, number>;
    reviewCoverage: {
      reviewed: number;
      unreviewed: number;
      modified: number;
    };
  };
  records: ProvenanceRecord[];
}

export function generateAuditReport(
  since?: string,
  opts: { includeGeneric?: boolean } = {}
): AuditReport {
  const includeGeneric = opts.includeGeneric ?? false;
  let records = readRecords().filter(
    (r) => isBrandedAgent(r.agentId) || includeGeneric
  );

  let fromDate = records.length > 0 ? records[records.length - 1].timestamp : new Date().toISOString();
  const toDate = new Date().toISOString();

  if (since) {
    const sinceDate = parseSince(since);
    if (sinceDate) {
      fromDate = sinceDate.toISOString();
      records = records.filter((r) => new Date(r.timestamp) >= sinceDate);
    }
  }

  const agentBreakdown: Record<string, number> = {};
  const reviewCoverage = { reviewed: 0, unreviewed: 0, modified: 0 };

  for (const r of records) {
    agentBreakdown[r.agentId] = (agentBreakdown[r.agentId] || 0) + 1;
    if (r.reviewStatus === "approved") reviewCoverage.reviewed++;
    else if (r.reviewStatus === "modified") reviewCoverage.modified++;
    else reviewCoverage.unreviewed++;
  }

  return {
    generatedAt: new Date().toISOString(),
    repository: getRepoName(),
    period: { from: fromDate, to: toDate },
    summary: {
      totalCommits: getTotalCommitCount(since),
      aiAuthoredCommits: records.length,
      aiAuthoredPercentage:
        getTotalCommitCount(since) > 0
          ? (records.length / getTotalCommitCount(since)) * 100
          : 0,
      agentBreakdown,
      reviewCoverage,
    },
    records,
  };
}

export function exportJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function exportCsv(report: AuditReport): string {
  const headers = [
    "commit_hash", "timestamp", "agent_id", "model_version",
    "confidence", "review_status", "reviewer",
    "files_changed", "lines_added", "lines_removed", "signals",
  ];

  const rows = report.records.map((r) => [
    r.commitHash, r.timestamp, r.agentId,
    r.modelVersion || "", r.confidence.toFixed(2),
    r.reviewStatus, r.reviewer || "",
    r.filesChanged.length.toString(),
    r.linesAdded.toString(), r.linesRemoved.toString(),
    r.signals.join(";"),
  ]);

  return [
    headers.join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\n");
}

export function exportSbom(report: AuditReport): string {
  const doc = {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `ai-provenance-${report.repository}`,
    documentNamespace: `https://codegov.dev/spdx/${report.repository}/${Date.now()}`,
    creationInfo: {
      created: report.generatedAt,
      creators: [`Tool: codegov-${VERSION}`],
    },
    documentDescribes: ["SPDXRef-Package"],
    packages: [
      {
        SPDXID: "SPDXRef-Package",
        name: report.repository,
        downloadLocation: "NOASSERTION",
        filesAnalyzed: false,
        copyrightText: "NOASSERTION",
        licenseConcluded: "NOASSERTION",
        licenseDeclared: "NOASSERTION",
        annotations: report.records.map((r) => ({
          annotationType: "REVIEW",
          annotator: `Tool: ${r.agentId}${r.modelVersion ? ` (${r.modelVersion})` : ""}`,
          annotationDate: toUtcZ(r.timestamp),
          annotationComment: [
            `Commit: ${r.commitHash}`,
            `Confidence: ${(r.confidence * 100).toFixed(0)}%`,
            `Review: ${r.reviewStatus}`,
            `Files: ${r.filesChanged.join(", ")}`,
            `Signals: ${r.signals.join(", ")}`,
          ].join(" | "),
        })),
      },
    ],
  };

  return JSON.stringify(doc, null, 2);
}

export function exportHtml(report: AuditReport): string {
  const s = report.summary;
  const agentRows = Object.entries(s.agentBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([agent, count]) => {
      const pct = s.totalCommits > 0 ? ((count / s.totalCommits) * 100).toFixed(1) : "0";
      return `<tr><td>${esc(agent)}</td><td>${count}</td><td>${pct}%</td></tr>`;
    })
    .join("\n            ");

  const commitRows = report.records
    .map((r) => {
      const hash = r.commitHash.slice(0, 7);
      const date = new Date(r.timestamp).toLocaleDateString();
      const conf = Math.round(r.confidence * 100);
      return `<tr>
              <td><code>${hash}</code></td>
              <td>${date}</td>
              <td><span class="agent agent-${esc(r.agentId)}">${esc(r.agentId)}</span></td>
              <td>${esc(r.modelVersion || "—")}</td>
              <td>${conf}%</td>
              <td>${r.filesChanged.length}</td>
              <td class="additions">+${r.linesAdded}</td>
              <td class="deletions">-${r.linesRemoved}</td>
              <td><span class="status status-${r.reviewStatus}">${r.reviewStatus}</span></td>
            </tr>`;
    })
    .join("\n            ");

  const reviewedPct = s.aiAuthoredCommits > 0
    ? Math.round((s.reviewCoverage.reviewed / s.aiAuthoredCommits) * 100)
    : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeGov Report — ${esc(report.repository)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    .subtitle { color: #8b949e; margin-bottom: 2rem; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.25rem; }
    .card .value { font-size: 2rem; font-weight: 700; color: #f0f6fc; }
    .card .label { color: #8b949e; font-size: 0.85rem; margin-top: 0.25rem; }
    .card .value.highlight { color: #58a6ff; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; margin-bottom: 2rem; }
    th { text-align: left; padding: 0.75rem 1rem; background: #21262d; color: #8b949e; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #30363d; }
    td { padding: 0.6rem 1rem; border-bottom: 1px solid #21262d; font-size: 0.9rem; }
    tr:last-child td { border-bottom: none; }
    code { background: #21262d; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.85rem; }
    .agent { padding: 0.15rem 0.5rem; border-radius: 12px; font-size: 0.8rem; font-weight: 500; }
    .agent-claude-code { background: #1a1a2e; color: #d4a574; }
    .agent-cursor { background: #1a2e1a; color: #7bc97b; }
    .agent-copilot { background: #1a2e2e; color: #79c0ff; }
    .agent-devin { background: #2e1a2e; color: #d2a8ff; }
    .agent-aider { background: #2e2e1a; color: #e3b341; }
    .additions { color: #3fb950; }
    .deletions { color: #f85149; }
    .status { padding: 0.15rem 0.5rem; border-radius: 12px; font-size: 0.75rem; }
    .status-unreviewed { background: #2e1a1a; color: #f85149; }
    .status-approved { background: #1a2e1a; color: #3fb950; }
    .status-modified { background: #2e2e1a; color: #e3b341; }
    .section-title { font-size: 1.1rem; margin-bottom: 1rem; color: #f0f6fc; }
    .footer { text-align: center; color: #484f58; font-size: 0.8rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #21262d; }
  </style>
</head>
<body>
  <h1>CodeGov Provenance Report</h1>
  <p class="subtitle">${esc(report.repository)} — generated ${new Date(report.generatedAt).toLocaleString()}</p>

  <div class="cards">
    <div class="card">
      <div class="value">${s.totalCommits}</div>
      <div class="label">Total Commits</div>
    </div>
    <div class="card">
      <div class="value highlight">${s.aiAuthoredCommits}</div>
      <div class="label">AI-Authored Commits</div>
    </div>
    <div class="card">
      <div class="value highlight">${s.aiAuthoredPercentage.toFixed(1)}%</div>
      <div class="label">AI-Authored</div>
    </div>
    <div class="card">
      <div class="value">${reviewedPct}%</div>
      <div class="label">Review Coverage</div>
    </div>
  </div>

  <h2 class="section-title">By Agent</h2>
  <table>
    <thead><tr><th>Agent</th><th>Commits</th><th>Share</th></tr></thead>
    <tbody>
      ${agentRows}
    </tbody>
  </table>

  <h2 class="section-title">AI-Authored Commits</h2>
  <table>
    <thead>
      <tr><th>Commit</th><th>Date</th><th>Agent</th><th>Model</th><th>Confidence</th><th>Files</th><th>Added</th><th>Removed</th><th>Review</th></tr>
    </thead>
    <tbody>
      ${commitRows}
    </tbody>
  </table>

  <div class="footer">Generated by CodeGov v${VERSION}</div>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function getRepoName(): string {
  // stderr ignored: `git remote get-url origin` exits non-zero (and prints to
  // stderr) when there is no origin remote, which is a normal case here.
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : "unknown";
  } catch {
    try {
      return execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("/")
        .pop()!;
    } catch {
      return "unknown";
    }
  }
}

function getTotalCommitCount(since?: string): number {
  const args = ["rev-list", "--count", "HEAD"];
  if (since) {
    // Use the same duration expansion as the scan path so the denominator
    // (total commits) matches the numerator (AI records). Git does not read
    // a bare "6m" as "6 months".
    args.push(`--since=${expandSince(since)}`);
  }
  try {
    return parseInt(
      execFileSync("git", args, { encoding: "utf-8" }).trim()
    );
  } catch {
    return 0;
  }
}

function parseSince(since: string): Date | null {
  const match = since.match(/^(\d+)([dhm])$/);
  if (!match) {
    const date = new Date(since);
    return isNaN(date.getTime()) ? null : date;
  }
  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();
  switch (unit) {
    case "d": now.setDate(now.getDate() - value); break;
    case "h": now.setHours(now.getHours() - value); break;
    case "m": now.setMonth(now.getMonth() - value); break;
  }
  return now;
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// SPDX requires UTC timestamps ending in "Z". Commit dates (%aI) carry a local
// offset, so normalize them before emitting into the SBOM.
function toUtcZ(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}
