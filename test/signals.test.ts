import { describe, it, expect } from "vitest";
import { analyzeBody, formatSignalsReport, type SignalsReport } from "../src/signals/index.js";

describe("analyzeBody — structural tell heuristic", () => {
  it("flags a long, bulleted AI-style body", () => {
    const body = [
      "Refactor the authentication module for clarity",
      "",
      "- Extract token validation into its own helper",
      "- Add explicit error handling for expired tokens",
      "- Normalize the session cookie name",
      "- Cover the new helper with unit tests",
    ].join("\n");
    const a = analyzeBody(body);
    expect(a.bullets).toBe(4);
    expect(a.hasTell).toBe(true);
  });

  it("does NOT flag a terse human one-liner", () => {
    const a = analyzeBody("Fix typo in README");
    expect(a.hasTell).toBe(false);
    expect(a.bullets).toBe(0);
  });

  it("strips attribution lines so a trailer cannot count as structure", () => {
    const body = [
      "Implement cache layer",
      "",
      "🤖 Generated with Claude Code",
      "",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    ].join("\n");
    const a = analyzeBody(body);
    expect(a.bodyLines).toBe(1); // only "Implement cache layer" survives
    expect(a.hasTell).toBe(false);
  });

  it("flags long multi-paragraph prose even without bullets", () => {
    const para =
      "This change reworks the retry logic so transient network failures back off exponentially.";
    const body = Array.from({ length: 9 }, (_, i) => `${para} (${i})`).join("\n");
    const a = analyzeBody(body);
    expect(a.bullets).toBe(0);
    expect(a.bodyLines).toBeGreaterThanOrEqual(8);
    expect(a.hasTell).toBe(true);
  });
});

describe("formatSignalsReport — fencing is loud and honest", () => {
  const report: SignalsReport = {
    totalCommits: 100,
    brandedAi: 20,
    untrailered: 70,
    tellAmongBranded: 16,
    tellAmongUntrailered: 7,
    brandedTellRate: 0.8,
    untraileredTellRate: 0.1,
    candidates: [
      {
        hash: "abcdef1234567890",
        timestamp: "2026-05-01T10:00:00Z",
        subject: "Refactor auth",
        bodyLen: 600,
        bodyLines: 12,
        bullets: 5,
        hasTell: true,
      },
    ],
  };

  it("declares EXPERIMENTAL and that nothing is counted", () => {
    const txt = formatSignalsReport(report);
    expect(txt).toContain("EXPERIMENTAL");
    expect(txt).toMatch(/NOT attribution/);
    expect(txt).toMatch(/counted in your AI %/);
    expect(txt).toMatch(/LEADS, not verdicts/);
  });

  it("shows the calibration: signal vs false-positive floor, and lists candidates", () => {
    const txt = formatSignalsReport(report);
    expect(txt).toContain("80%"); // branded tell rate = the signal
    expect(txt).toContain("10%"); // untrailered tell rate = false-positive floor
    expect(txt).toContain("abcdef1"); // candidate commit listed
  });

  it("warns when there is too little ground truth to calibrate", () => {
    const txt = formatSignalsReport({ ...report, brandedAi: 2 });
    expect(txt).toMatch(/too few to calibrate/i);
  });
});
