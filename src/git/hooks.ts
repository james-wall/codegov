import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const POST_COMMIT_HOOK = `#!/bin/sh
# CodeGov post-commit hook — records AI provenance for each commit
codegov record-commit HEAD
`;

function getGitDir(): string {
  return execFileSync("git", ["rev-parse", "--git-dir"], {
    encoding: "utf-8",
  }).trim();
}

export function installHooks(): { installed: string[]; skipped: string[] } {
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
  }).trim();

  const hooksDir = join(getGitDir(), "hooks");
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const installed: string[] = [];
  const skipped: string[] = [];

  const postCommitPath = join(hooksDir, "post-commit");
  if (existsSync(postCommitPath)) {
    skipped.push("post-commit (already exists)");
  } else {
    writeFileSync(postCommitPath, POST_COMMIT_HOOK);
    chmodSync(postCommitPath, 0o755);
    installed.push("post-commit");
  }

  const codgovDir = join(repoRoot, ".codegov");
  if (!existsSync(codgovDir)) {
    mkdirSync(codgovDir, { recursive: true });
  }

  const gitignorePath = join(repoRoot, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".codegov")) {
      writeFileSync(gitignorePath, content.trimEnd() + "\n.codegov/\n");
    }
  } else {
    writeFileSync(gitignorePath, ".codegov/\n");
  }

  return { installed, skipped };
}
