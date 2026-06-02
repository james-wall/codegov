import { describe, it, expect } from "vitest";
import { detectAgent, isBrandedAgent, type CommitInfo } from "../src/detect/engine.js";

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

describe("expanded tool coverage (signatures verified against real commits)", () => {
  it("Aider — new noreply@aider.chat trailer, still extracts the model", () => {
    const d = detectAgent(
      commit({ trailers: "Co-authored-by: aider (claude-sonnet-4-5) <noreply@aider.chat>" })
    );
    expect(d.agentId).toBe("aider");
    expect(d.modelVersion).toBe("claude-sonnet-4-5");
  });

  it("Aider — noreply@aider.chat without a (model) segment", () => {
    expect(
      detectAgent(commit({ trailers: "Co-authored-by: aider <noreply@aider.chat>" })).agentId
    ).toBe("aider");
  });

  it("Devin — direct bot@devin.ai author email", () => {
    expect(detectAgent(commit({ author: "Devin", email: "bot@devin.ai" })).agentId).toBe("devin");
  });

  it("Codex — 'Co-authored-by: Codex <noreply@openai.com>' trailer", () => {
    expect(
      detectAgent(commit({ trailers: "Co-authored-by: Codex <noreply@openai.com>" })).agentId
    ).toBe("codex");
  });

  it("Codex — codex[bot] and openai-codex[bot] app accounts", () => {
    expect(
      detectAgent(
        commit({ author: "codex[bot]", email: "29005841+codex[bot]@users.noreply.github.com" })
      ).agentId
    ).toBe("codex");
    expect(
      detectAgent(
        commit({ email: "215057067+openai-codex[bot]@users.noreply.github.com" })
      ).agentId
    ).toBe("codex");
  });

  it("Gemini CLI — co-author email", () => {
    expect(
      detectAgent(
        commit({
          trailers: "Co-authored-by: gemini-cli <218195315+gemini-cli@users.noreply.github.com>",
        })
      ).agentId
    ).toBe("gemini");
  });

  it("Jules — google-labs-jules[bot]", () => {
    expect(
      detectAgent(
        commit({
          author: "google-labs-jules[bot]",
          email: "161369871+google-labs-jules[bot]@users.noreply.github.com",
        })
      ).agentId
    ).toBe("jules");
  });

  it("OpenHands — openhands-agent identity and all-hands.dev co-author", () => {
    expect(
      detectAgent(
        commit({
          author: "openhands-agent",
          email: "175740463+openhands-agent@users.noreply.github.com",
        })
      ).agentId
    ).toBe("openhands");
    expect(
      detectAgent(commit({ trailers: "Co-authored-by: openhands <openhands@all-hands.dev>" })).agentId
    ).toBe("openhands");
  });

  it("Sweep — sweep-ai-deprecated[bot] and sweep-nightly[bot]", () => {
    expect(detectAgent(commit({ author: "sweep-ai-deprecated[bot]" })).agentId).toBe("sweep");
    expect(
      detectAgent(
        commit({ email: "131841235+sweep-nightly[bot]@users.noreply.github.com" })
      ).agentId
    ).toBe("sweep");
  });

  it("JetBrains Junie — jetbrains-junie[bot]", () => {
    expect(detectAgent(commit({ author: "jetbrains-junie[bot]" })).agentId).toBe("jetbrains");
  });

  it("Augment — augmentcode[bot]", () => {
    expect(
      detectAgent(
        commit({ email: "185243770+augmentcode[bot]@users.noreply.github.com" })
      ).agentId
    ).toBe("augment");
  });

  it("all new tools count as branded (toward the headline)", () => {
    for (const a of ["codex", "gemini", "jules", "openhands", "sweep", "jetbrains", "augment"] as const) {
      expect(isBrandedAgent(a)).toBe(true);
    }
  });
});

describe("new tools — no false positives", () => {
  it("does NOT flag review-only bots (they comment on PRs, they do not author commits)", () => {
    expect(
      detectAgent(
        commit({
          author: "chatgpt-codex-connector[bot]",
          email: "199175422+chatgpt-codex-connector[bot]@users.noreply.github.com",
        })
      ).agentId
    ).toBe("human");
    expect(
      detectAgent(
        commit({
          author: "gemini-code-assist[bot]",
          email: "176961590+gemini-code-assist[bot]@users.noreply.github.com",
        })
      ).agentId
    ).toBe("human");
    expect(detectAgent(commit({ author: "amazon-q-developer[bot]" })).agentId).toBe("human");
    expect(detectAgent(commit({ author: "sourcegraph-cody[bot]" })).agentId).toBe("human");
  });

  it("does NOT flag a human commit that merely mentions a tool domain in prose", () => {
    expect(
      detectAgent(commit({ body: "Point the webhook at noreply@openai.com for parity" })).agentId
    ).toBe("human");
    expect(
      detectAgent(
        commit({ author: "Real Human", email: "real@corp.com", body: "Integrate the openhands SDK" })
      ).agentId
    ).toBe("human");
  });
});
