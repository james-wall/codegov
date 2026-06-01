import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Single source of truth for the version: read it from package.json at runtime.
// dist/version.js -> ../package.json resolves to the package root both in this
// repo and inside an installed npm package (npm always ships package.json).
const here = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf-8")
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
