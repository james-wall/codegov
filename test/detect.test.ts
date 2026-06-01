import { describe, it, expect } from "vitest";
import {
  detectAgent,
  isBrandedAgent,
  BRANDED_AGENTS,
  type CommitInfo,
} from "../src/detect/engine.js";

function commit(overrides: Partial<CommitInfo>): CommitInfo {
  return {
    hash: "0".repeat(40),
    message: "",
    body: "",
    author: "Jane Dev",
    email: "jane@example.com",
    trailers: "",
    ...overrides,
  };
}

describe("branded detectors (high precision)", () => {
  it("detects Claude Code from trailer + marker", () => {
    const d = detectAgent(
      commit({
        body: "Implement cache\n\nGenerated with Claude Code\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
        trailers: "Co-Authored-By: Claude <noreply@anthropic.com>",
      })
    );
    expect(d.agentId).toBe("claude-code");
    expect(d.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects Cursor from cursor[bot] author", () => {
    expect(detectAgent(commit({ author: "cursor[bot]" })).agentId).toBe("cursor");
  });

  it("detects Copilot from co-author email", () => {
    const d = detectAgent(
      commit({ trailers: "Co-authored-by: Copilot <copilot@github.com>" })
    );
    expect(d.agentId).toBe("copilot");
  });

  it("attributes Devin to devin even though its bot email contains 'ai'", () => {
    // devin-ai-integration[bot] literally contains "ai" — the branded detector
    // must win over the generic one.
    const d = detectAgent(
      commit({
        email: "158243242+devin-ai-integration[bot]@users.noreply.github.com",
      })
    );
    expect(d.agentId).toBe("devin");
  });

  it("detects Aider and extracts the model", () => {
    const d = detectAgent(
      commit({
        trailers: "Co-authored-by: aider (gpt-4o) <aider@aider.chat>",
      })
    );
    expect(d.agentId).toBe("aider");
    expect(d.modelVersion).toBe("gpt-4o");
  });
});

describe("no false positives on ordinary human commits (regression)", () => {
  it("does NOT flag a gmail co-author as AI", () => {
    // "gmail" contains the substring "ai" — the original bug flagged this.
    const d = detectAgent(
      commit({
        message: "Fix login validation",
        body: "Co-authored-by: John Doe <john@gmail.com>",
        trailers: "Co-authored-by: John Doe <john@gmail.com>",
      })
    );
    expect(d.agentId).toBe("human");
    expect(d.confidence).toBe(0);
  });

  it("does NOT flag a co-author whose name contains 'ai' (Claire)", () => {
    const d = detectAgent(
      commit({ trailers: "Co-authored-by: Claire Smith <claire@example.org>" })
    );
    expect(d.agentId).toBe("human");
  });

  it("does NOT flag hotmail / Mikhail", () => {
    expect(
      detectAgent(
        commit({ trailers: "Co-authored-by: Mikhail R <mikhail@hotmail.com>" })
      ).agentId
    ).toBe("human");
  });

  it("excludes dependabot and other non-AI bots", () => {
    const d = detectAgent(
      commit({
        body: "Co-authored-by: dependabot[bot] <support@dependabot.com>",
        trailers: "Co-authored-by: dependabot[bot] <support@dependabot.com>",
      })
    );
    expect(d.agentId).toBe("human");
  });
});

describe("generic detection still works when the signal is genuine", () => {
  it("flags an explicit AI co-author as unknown-ai", () => {
    const d = detectAgent(
      commit({ trailers: "Co-authored-by: AI Assistant <ai@example.com>" })
    );
    expect(d.agentId).toBe("unknown-ai");
    expect(d.confidence).toBeGreaterThan(0.3);
  });

  it("classifies unknown-ai as NOT branded", () => {
    expect(isBrandedAgent("unknown-ai")).toBe(false);
    expect(isBrandedAgent("human")).toBe(false);
    for (const a of BRANDED_AGENTS) expect(isBrandedAgent(a)).toBe(true);
  });
});
