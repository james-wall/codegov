import { getCommitLog, RawCommit } from "../git/parser.js";
import { detectAgent, isBrandedAgent } from "../detect/engine.js";

// EXPERIMENTAL structural signals.
//
// A separation study across real repos (see benchmark notes) found that AI-
// authored commits tend to have long, bulleted, multi-paragraph bodies — the
// commit-body structure separates AI from human at AUC ~0.8. BUT as a per-commit
// classifier its precision is only ~14-41% and swings by repo, because plenty of
// careful humans write the same way. So this module NEVER assigns a verdict and
// NEVER feeds the headline AI %. It only:
//   1. reports the repo-level structural distribution, and
//   2. surfaces untrailered commits that share the "tell" as leads for a human to
//      eyeball — calibrated against the repo's own explicitly-AI-signed commits.

export interface BodyAnalysis {
  bodyLen: number;   // chars of the body with attribution/trailer lines removed
  bodyLines: number; // non-empty, non-attribution body lines
  bullets: number;   // bullet-list lines
  hasTell: boolean;  // matches the (deliberately loose) AI structural heuristic
}

export interface CandidateCommit extends BodyAnalysis {
  hash: string;
  timestamp: string;
  subject: string;
}

export interface SignalsReport {
  totalCommits: number;
  brandedAi: number;            // commits with an explicit AI signature (ground truth)
  untrailered: number;          // commits with NO AI signature (human or silently AI-assisted)
  tellAmongBranded: number;
  tellAmongUntrailered: number;
  brandedTellRate: number;      // tellAmongBranded / brandedAi
  untraileredTellRate: number;  // tellAmongUntrailered / untrailered  (the false-positive floor)
  candidates: CandidateCommit[]; // untrailered commits WITH the tell — leads, not verdicts
}

// A line that carries the AI *signature* rather than authored prose. Stripped
// before measuring structure so an AI commit's own trailer can't count as "style".
function isAttrLine(l: string): boolean {
  return (
    /^\s*(co-authored-by:|signed-off-by:|made-with:|agent-logs-url:|assisted-by:)/i.test(l) ||
    /generated\s+(with|by)/i.test(l) ||
    /applied via @cursor/i.test(l) ||
    l.includes("\u{1F916}") || // 🤖
    /^\s*aider \(/i.test(l)
  );
}

export function analyzeBody(body: string): BodyAnalysis {
  const styleLines = body.split("\n").filter((l) => l.trim() && !isAttrLine(l));
  const bullets = styleLines.filter((l) => /^\s*[-*]\s+/.test(l)).length;
  const bodyLen = styleLines.join("\n").length;
  const bodyLines = styleLines.length;
  // Thresholds sit between the AI and human medians from the separation study.
  // Deliberately loose: this is a lead generator, not a classifier.
  const hasTell = bullets >= 3 || (bodyLines >= 8 && bodyLen >= 500);
  return { bodyLen, bodyLines, bullets, hasTell };
}

export function computeSignals(
  opts: { since?: string; path?: string; limit?: number } = {}
): SignalsReport {
  const commits = getCommitLog({ since: opts.since, path: opts.path, noStat: true });

  let brandedAi = 0;
  let untrailered = 0;
  let tellAmongBranded = 0;
  let tellAmongUntrailered = 0;
  const candidates: CandidateCommit[] = [];

  for (const c of commits as RawCommit[]) {
    const det = detectAgent(c);
    const isBranded = det.confidence > 0.3 && isBrandedAgent(det.agentId);
    const hasAnyAiSignal = det.confidence > 0.3; // branded OR generic unknown-ai
    const a = analyzeBody(c.body);

    if (isBranded) {
      brandedAi++;
      if (a.hasTell) tellAmongBranded++;
    } else if (!hasAnyAiSignal) {
      // No signature at all — human, or AI that left no trace. These are the only
      // commits we can offer as "untrailered AI" candidates.
      untrailered++;
      if (a.hasTell) {
        tellAmongUntrailered++;
        candidates.push({ ...a, hash: c.hash, timestamp: c.timestamp, subject: c.message });
      }
    }
    // commits whose only signal is generic "unknown-ai" are excluded from both buckets
  }

  candidates.sort((x, y) => y.bodyLen - x.bodyLen);

  return {
    totalCommits: commits.length,
    brandedAi,
    untrailered,
    tellAmongBranded,
    tellAmongUntrailered,
    brandedTellRate: brandedAi > 0 ? tellAmongBranded / brandedAi : 0,
    untraileredTellRate: untrailered > 0 ? tellAmongUntrailered / untrailered : 0,
    candidates: opts.limit != null ? candidates.slice(0, opts.limit) : candidates,
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function formatSignalsReport(r: SignalsReport): string {
  const out: string[] = [];
  out.push("⚠  EXPERIMENTAL — heuristic structural signals, NOT attribution.");
  out.push("   Nothing here is counted in your AI % (run `codegov scan` for that number).");
  out.push("   Commit-body structure correlates with AI assistance but does NOT prove it.");
  out.push("");
  out.push(`Analyzed ${r.totalCommits} commits.`);
  out.push(`  Explicitly AI-signed (ground truth):    ${r.brandedAi}`);
  out.push(`  No AI signature (human or untrailered): ${r.untrailered}`);
  out.push("");
  out.push('Structural "tell" = a long, bulleted, multi-paragraph commit body.');

  const calibrated = r.brandedAi >= 5;
  if (calibrated) {
    out.push("Calibration on THIS repo:");
    out.push(`  ${pct(r.brandedTellRate)} of AI-signed commits have the tell   ← the signal`);
    out.push(`  ${pct(r.untraileredTellRate)} of un-signed commits have the tell   ← your false-positive floor`);
  } else {
    out.push(`(Only ${r.brandedAi} AI-signed commit(s) here — too few to calibrate the tell.`);
    out.push(" Treat the candidates below with extra skepticism.)");
  }
  out.push("");

  if (r.candidates.length === 0) {
    out.push("No un-signed commits matched the structural tell.");
    return out.join("\n");
  }

  out.push(`${r.tellAmongUntrailered} un-signed commit(s) share the AI structural tell — candidates worth a look.`);
  out.push(`Showing ${r.candidates.length}. These are LEADS, not verdicts — many will be careful humans:`);
  out.push("");
  for (const c of r.candidates) {
    const subj = c.subject.length > 56 ? c.subject.slice(0, 53) + "..." : c.subject;
    out.push(
      `  ${c.hash.slice(0, 7)}  ${c.timestamp.slice(0, 10)}  ` +
        `${String(c.bodyLines).padStart(3)} lines / ${c.bullets} bullets   ${subj}`
    );
  }
  out.push("");
  if (calibrated) {
    out.push(`Read the ${pct(r.untraileredTellRate)} un-signed tell-rate as your false-positive expectation:`);
    out.push("most flagged commits are humans who write structured messages. Spot-check, never count.");
  } else {
    out.push("Spot-check these by hand. Never treat structure as proof of AI authorship.");
  }
  return out.join("\n");
}
