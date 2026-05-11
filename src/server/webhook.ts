import type { Request, Response } from "express";
import { insertCommit, correlateCommit } from "../db/queries.js";

interface CommitPayload {
  hash: string;
  author: string;
  timestamp: string;
  repo?: string;
  branch?: string;
  message?: string;
  total_additions?: number;
  total_deletions?: number;
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
}

export function handleCommitHook(req: Request, res: Response): void {
  const payload = req.body as CommitPayload;

  if (!payload.hash || !payload.author || !payload.timestamp) {
    res.status(400).json({ error: "Missing required fields: hash, author, timestamp" });
    return;
  }

  insertCommit({
    hash: payload.hash,
    author: payload.author,
    timestamp: payload.timestamp,
    repo: payload.repo,
    branch: payload.branch,
    message: payload.message,
    total_additions: payload.total_additions,
    total_deletions: payload.total_deletions,
    files: payload.files ?? [],
  });

  correlateCommit(payload.hash);

  res.status(200).json({ stored: true, hash: payload.hash });
}
