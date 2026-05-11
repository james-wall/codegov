import { execFileSync } from "node:child_process";

export interface RawCommit {
  hash: string;
  timestamp: string;
  author: string;
  email: string;
  message: string;
  body: string;
  trailers: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
}

const RECORD_START = "<<CODEGOV_RS>>";
const RECORD_END = "<<CODEGOV_RE>>";
const FIELD_SEP = "<<CODEGOV_FS>>";
const BODY_SEP = "<<CODEGOV_BS>>";

function buildFormat(): string {
  return RECORD_START +
    ["%H", "%aI", "%an", "%ae", "%s"].join(FIELD_SEP) +
    BODY_SEP + "%b" + BODY_SEP + "%(trailers)" +
    RECORD_END;
}

export function getCommitLog(
  since?: string,
  path?: string,
  cwd?: string
): RawCommit[] {
  const args = [
    "log",
    `--format=${buildFormat()}`,
    "--numstat",
  ];

  if (since) {
    args.push(`--since=${expandSince(since)}`);
  }

  if (path) {
    args.push("--", path);
  }

  let output: string;
  try {
    output = execFileSync("git", args, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
      ...(cwd ? { cwd } : {}),
    });
  } catch {
    return [];
  }

  return parseOutput(output);
}

export function parseOutput(output: string): RawCommit[] {
  const commits: RawCommit[] = [];
  const blocks = output.split(RECORD_START);

  for (const block of blocks) {
    if (!block.includes(RECORD_END)) continue;

    const [formatPart, afterEnd] = block.split(RECORD_END);

    const bodyParts = formatPart!.split(BODY_SEP);
    if (bodyParts.length < 3) continue;

    const headerStr = bodyParts[0]!.trim();
    const body = (bodyParts[1] || "").trim();
    const trailers = (bodyParts[2] || "").trim();

    const fields = headerStr.split(FIELD_SEP);
    if (fields.length < 5) continue;

    const [hash, timestamp, author, email, message] = fields;

    let linesAdded = 0;
    let linesRemoved = 0;
    const filesChanged: string[] = [];

    if (afterEnd) {
      for (const line of afterEnd.split("\n")) {
        const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (m) {
          linesAdded += m[1] === "-" ? 0 : parseInt(m[1]);
          linesRemoved += m[2] === "-" ? 0 : parseInt(m[2]);
          filesChanged.push(m[3]);
        }
      }
    }

    commits.push({
      hash: hash!,
      timestamp: timestamp!,
      author: author!,
      email: email!,
      message: message!,
      body,
      trailers,
      filesChanged,
      linesAdded,
      linesRemoved,
    });
  }

  return commits;
}

function expandSince(since: string): string {
  const match = since.match(/^(\d+)([dhm])$/);
  if (!match) return since;
  const value = match[1];
  const unit = match[2];
  switch (unit) {
    case "d": return `${value} days ago`;
    case "h": return `${value} hours ago`;
    case "m": return `${value} months ago`;
    default: return since;
  }
}

export function getCommitDetail(hash: string, cwd?: string): RawCommit | null {
  let output: string;
  try {
    output = execFileSync("git", [
      "log", "-1",
      `--format=${buildFormat()}`,
      "--numstat",
      hash,
    ], {
      encoding: "utf-8",
      ...(cwd ? { cwd } : {}),
    });
  } catch {
    return null;
  }
  const commits = parseOutput(output);
  return commits[0] || null;
}
