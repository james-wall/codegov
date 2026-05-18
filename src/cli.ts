#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { installHooks } from "./git/hooks.js";
import { scanHistory, forensics, computeStats } from "./scan/index.js";
import { queryRecords, readRecords, ensureStoreExists } from "./scan/store.js";
import { getCommitDetail } from "./git/parser.js";
import { detectAgent } from "./detect/engine.js";
import { appendRecord } from "./scan/store.js";
import { generateAuditReport, exportJson, exportCsv, exportSbom, exportHtml } from "./export/formats.js";

function requireGitRepo(): void {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf-8", stdio: "pipe" });
  } catch {
    console.error("Not a git repository. Run this command inside a git repo.");
    process.exit(1);
  }
}

const program = new Command();

program
  .name("codegov")
  .description("AI code governance — attribution, telemetry, and ROI for AI-assisted development")
  .version("0.1.0");

// ── Zero-config commands (no server, no SQLite) ─────────────────────

program
  .command("scan")
  .description("Scan git history for AI-authored commits (zero-config, works on any repo)")
  .option("--since <duration>", "Time period to scan (e.g., 90d, 6m)")
  .option("--path <path>", "Limit scan to a specific path")
  .option("--format <format>", "Output format: text, json, html", "text")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .action((opts) => {
    requireGitRepo();
    console.log("Scanning git history for AI-authored commits...\n");
    const result = scanHistory(opts.since, opts.path);

    if (opts.format === "json") {
      const report = generateAuditReport(opts.since);
      const output = exportJson(report);
      if (opts.output) {
        writeFileSync(opts.output, output);
        console.log(`Report written to ${opts.output}`);
      } else {
        console.log(output);
      }
      return;
    }

    if (opts.format === "html") {
      const report = generateAuditReport(opts.since);
      const output = exportHtml(report);
      const file = opts.output ?? "codegov-report.html";
      writeFileSync(file, output);
      console.log(`HTML report written to ${file}`);
      return;
    }

    if (result.totalCommits === 0) {
      console.log("No commits found. Are you in a git repository?");
      return;
    }

    const pct = ((result.aiCommits / result.totalCommits) * 100).toFixed(1);

    // Agent breakdown from records in the scan window only
    const agentCounts: Record<string, number> = {};
    for (const r of result.allInRange) {
      agentCounts[r.agentId] = (agentCounts[r.agentId] || 0) + 1;
    }

    const agentSummary = Object.entries(agentCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([agent, count]) => `${count} ${agent}`)
      .join(", ");

    // Headline
    console.log(`${pct}% of commits are AI-authored (${result.aiCommits}/${result.totalCommits})`);
    if (agentSummary) {
      console.log(`Agents: ${agentSummary}`);
    }

    if (result.newRecords === 0 && result.aiCommits > 0) {
      console.log(`\n(no new AI commits found — ${result.aiCommits} already tracked)`);
      return;
    }

    // Show up to 15 commits, then summarize the rest
    const MAX_SHOWN = 15;
    const toShow = result.records.slice(0, MAX_SHOWN);

    if (toShow.length > 0) {
      console.log(`\nDetected commits:`);
      for (const record of toShow) {
        const conf = Math.round(record.confidence * 100);
        const model = record.modelVersion ? ` [${record.modelVersion}]` : "";
        console.log(
          `  ${record.commitHash.slice(0, 7)}  ${record.agentId}${model}  +${record.linesAdded}/-${record.linesRemoved}  (${conf}%)`
        );
      }
      if (result.records.length > MAX_SHOWN) {
        console.log(`  ... and ${result.records.length - MAX_SHOWN} more`);
      }
    }

    console.log(`\nResults saved to .codegov/events.jsonl`);
  });

program
  .command("stats")
  .description("Show summary statistics of AI-authored code")
  .action(() => {
    requireGitRepo();
    const stats = computeStats();

    if (stats.totalCommits === 0) {
      console.log("No commit history found. Run 'codegov scan' first.");
      return;
    }

    console.log("CodeGov Statistics\n");
    console.log(`Total commits: ${stats.totalCommits}`);
    console.log(`AI-authored: ${stats.aiCommits} (${stats.aiPercentage.toFixed(1)}%)`);

    if (Object.keys(stats.byAgent).length > 0) {
      console.log(`\nBy Agent:`);
      for (const [agent, count] of Object.entries(stats.byAgent).sort(
        (a, b) => b[1] - a[1]
      )) {
        const pct = ((count / stats.totalCommits) * 100).toFixed(1);
        console.log(`  ${agent}: ${count} commits (${pct}%)`);
      }
    }

    if (Object.keys(stats.byMonth).length > 0) {
      console.log(`\nBy Month:`);
      for (const [month, data] of Object.entries(stats.byMonth).sort()) {
        const pct = data.total > 0 ? ((data.ai / data.total) * 100).toFixed(0) : "0";
        console.log(`  ${month}: ${data.ai}/${data.total} AI commits (${pct}%)`);
      }
    }
  });

program
  .command("query")
  .description("Query provenance records with filters")
  .option("--path <path>", "Filter by file path prefix")
  .option("--agent <agent>", "Filter by agent (claude-code, cursor, copilot, devin, aider)")
  .option("--since <duration>", "Filter by time (e.g., 90d, 6m, 2024-01-01)")
  .action((opts) => {
    requireGitRepo();
    const records = queryRecords(opts);

    if (records.length === 0) {
      console.log("No matching records found.");
      console.log("Run 'codegov scan' first to populate the event log.");
      return;
    }

    console.log(`Found ${records.length} matching record(s):\n`);
    for (const record of records) {
      console.log(`Commit: ${record.commitHash.slice(0, 7)}`);
      console.log(`  Agent: ${record.agentId}`);
      console.log(`  Model: ${record.modelVersion || "unknown"}`);
      console.log(`  Time: ${record.timestamp}`);
      console.log(`  Files: ${record.filesChanged.length} changed (+${record.linesAdded}/-${record.linesRemoved})`);
      console.log(`  Confidence: ${Math.round(record.confidence * 100)}%`);
      console.log(`  Signals: ${record.signals.join(", ")}`);
      console.log("");
    }
  });

program
  .command("forensics <hash>")
  .description("Show full provenance record for a commit")
  .action((hash: string) => {
    requireGitRepo();
    const record = forensics(hash);

    if (!record) {
      console.log(`Commit ${hash} not found.`);
      return;
    }

    console.log(`Provenance Record: ${record.commitHash}\n`);
    console.log(`  Agent: ${record.agentId}`);
    console.log(`  Model: ${record.modelVersion || "unknown"}`);
    console.log(`  Timestamp: ${record.timestamp}`);
    console.log(`  Confidence: ${Math.round(record.confidence * 100)}%`);
    console.log(`  Review Status: ${record.reviewStatus}`);
    console.log(`  Reviewer: ${record.reviewer || "none"}`);
    console.log(`\n  Signals:`);
    for (const signal of record.signals) {
      console.log(`    - ${signal}`);
    }
    console.log(`\n  Files Changed (${record.filesChanged.length}):`);
    for (const file of record.filesChanged) {
      console.log(`    ${file}`);
    }
    console.log(`\n  Lines: +${record.linesAdded} / -${record.linesRemoved}`);

    if (record.agentId === "human") {
      console.log(`\n  Note: No AI authorship signals detected for this commit.`);
    }
  });

program
  .command("export")
  .description("Export audit report in various formats")
  .option("--format <format>", "Output format: json, csv, sbom, html", "json")
  .option("--since <duration>", "Filter by time period")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .action((opts: { format: string; since?: string; output?: string }) => {
    const report = generateAuditReport(opts.since);

    let output: string;
    switch (opts.format) {
      case "csv":
        output = exportCsv(report);
        break;
      case "sbom":
        output = exportSbom(report);
        break;
      case "html":
        output = exportHtml(report);
        if (!opts.output) opts.output = "codegov-report.html";
        break;
      case "json":
      default:
        output = exportJson(report);
        break;
    }

    if (opts.output) {
      writeFileSync(opts.output, output);
      console.log(`Report written to ${opts.output}`);
    } else {
      console.log(output);
    }
  });

program
  .command("share")
  .description("Generate an HTML report and share it as a GitHub Gist")
  .option("--since <duration>", "Filter by time period")
  .option("--public", "Make the Gist public (default: secret)")
  .action((opts: { since?: string; public?: boolean }) => {
    const report = generateAuditReport(opts.since);
    const html = exportHtml(report);

    const tmpFile = `/tmp/codegov-report-${Date.now()}.html`;
    writeFileSync(tmpFile, html);

    try {
      const ghArgs = [
        "gist", "create",
        tmpFile,
        "--filename", `codegov-${report.repository}.html`,
        "--desc", `CodeGov provenance report for ${report.repository} — ${report.summary.aiAuthoredCommits}/${report.summary.totalCommits} AI-authored commits`,
      ];
      if (opts.public) ghArgs.push("--public");

      const gistUrl = execFileSync("gh", ghArgs, { encoding: "utf-8" }).trim();

      try { unlinkSync(tmpFile); } catch { /* noop */ }

      console.log(`\nReport shared!`);
      console.log(`  Gist: ${gistUrl}`);
      console.log(`\n  ${report.summary.aiAuthoredCommits}/${report.summary.totalCommits} commits AI-authored (${report.summary.aiAuthoredPercentage.toFixed(1)}%)`);
    } catch {
      try { unlinkSync(tmpFile); } catch { /* noop */ }
      console.error("Failed to create Gist. Make sure gh CLI is installed and authenticated.");
      process.exit(1);
    }
  });

// ── Setup + server commands ─────────────────────────────────────────

program
  .command("init")
  .description("Install git hooks, initialize tracking, and scan history")
  .option("--no-scan", "Skip the initial history scan")
  .action((opts: { scan: boolean }) => {
    requireGitRepo();
    const { installed, skipped } = installHooks();
    ensureStoreExists();

    console.log("CodeGov initialized.");
    if (installed.length > 0) {
      console.log(`  Installed hooks: ${installed.join(", ")}`);
    }
    if (skipped.length > 0) {
      console.log(`  Skipped: ${skipped.join(", ")}`);
    }
    console.log("  Event log: .codegov/events.jsonl");

    if (opts.scan) {
      console.log("\nScanning git history...\n");
      const result = scanHistory();

      console.log(`  Commits scanned: ${result.totalCommits}`);
      console.log(`  AI-authored found: ${result.aiCommits}`);

      if (result.records.length > 0) {
        const agents = new Set(result.records.map((r) => r.agentId));
        console.log(`  Agents detected: ${[...agents].join(", ")}`);
      }

      console.log("\nRun 'codegov stats' for full breakdown.");
    }
  });

program
  .command("server")
  .description("Start the CodeGov collector server (OTEL + webhook + dashboard)")
  .option("-p, --port <port>", "Port to listen on", "4318")
  .action(async (opts: { port: string }) => {
    try {
      const { startServer } = await import("./server/index.js");
      startServer(parseInt(opts.port, 10));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("better-sqlite3") || msg.includes("express")) {
        console.error("The server requires additional dependencies.");
        console.error("Run: npm install better-sqlite3 express");
        process.exit(1);
      }
      throw err;
    }
  });

// ── Internal command (used by git hook) ─────────────────────────────

program
  .command("record-commit <ref>")
  .description("Record provenance for a single commit (used by git hook)")
  .action((ref: string) => {
    requireGitRepo();
    const commit = getCommitDetail(ref);
    if (!commit) {
      process.exit(1);
    }

    const detection = detectAgent(commit);
    if (detection.confidence > 0.3) {
      ensureStoreExists();
      appendRecord({
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
      });
    }
  });

// Default to scan when no subcommand given
if (process.argv.length <= 2) {
  process.argv.push("scan");
}

program.parse();
