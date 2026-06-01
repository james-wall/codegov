import { describe, it, expect } from "vitest";
import { exportSbom, AuditReport } from "../src/export/formats.js";

// SPDX 2.3 requires UTC timestamps as "YYYY-MM-DDThh:mm:ssZ" — Z-terminated with
// NO fractional seconds. Anchored so a trailing ".123Z" or local offset fails.
const SPDX_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// Input deliberately carries the two shapes that used to slip through:
//  - record timestamp with a local offset AND milliseconds
//  - generatedAt with milliseconds
function sampleReport(): AuditReport {
  return {
    generatedAt: "2026-06-01T21:51:52.650Z",
    repository: "demo-repo",
    period: { from: "2026-05-01T12:30:45.123-04:00", to: "2026-06-01T21:51:52.650Z" },
    summary: {
      totalCommits: 10,
      aiAuthoredCommits: 1,
      aiAuthoredPercentage: 10,
      agentBreakdown: { "claude-code": 1 },
      reviewCoverage: { reviewed: 0, unreviewed: 1, modified: 0 },
    },
    records: [
      {
        commitHash: "abc123def4567890",
        timestamp: "2026-05-01T12:30:45.123-04:00",
        agentId: "claude-code",
        modelVersion: "Claude Opus 4.6",
        promptSummary: null,
        filesChanged: ["src/a.ts", "src/b.ts"],
        linesAdded: 5,
        linesRemoved: 2,
        reviewStatus: "unreviewed",
        reviewer: null,
        confidence: 0.95,
        signals: ["co-authored-by-claude-trailer"],
      },
    ],
  };
}

describe("exportSbom — SPDX 2.3 conformance (regression guard)", () => {
  const sbom = JSON.parse(exportSbom(sampleReport()));

  it("declares SPDX-2.3 + CC0 + a DESCRIBES link to the package", () => {
    expect(sbom.spdxVersion).toBe("SPDX-2.3");
    expect(sbom.dataLicense).toBe("CC0-1.0");
    expect(sbom.SPDXID).toBe("SPDXRef-DOCUMENT");
    expect(sbom.documentDescribes).toContain("SPDXRef-Package");
  });

  it("creationInfo.created is UTC with no fractional seconds", () => {
    expect(sbom.creationInfo.created).toMatch(SPDX_DATE);
  });

  it("package sets filesAnalyzed:false and uses the plural annotations[] key", () => {
    const pkg = sbom.packages[0];
    expect(pkg.filesAnalyzed).toBe(false);
    expect(Array.isArray(pkg.annotations)).toBe(true);
    expect(pkg.annotations.length).toBe(1);
    // the original bug: a singular "annotation" key that validators ignore
    expect(pkg).not.toHaveProperty("annotation");
  });

  it("each annotation uses `comment` (not annotationComment) and a Z-date without ms", () => {
    for (const a of sbom.packages[0].annotations) {
      expect(a).not.toHaveProperty("annotationComment");
      expect(typeof a.comment).toBe("string");
      expect(a.comment.length).toBeGreaterThan(0);
      expect(a.annotationDate).toMatch(SPDX_DATE);
      expect(["REVIEW", "OTHER"]).toContain(a.annotationType);
      expect(a.annotator).toMatch(/^(Tool|Person|Organization): /);
    }
  });
});
