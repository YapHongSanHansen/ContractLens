import { execSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import path from "path";
import os from "os";
import type { SlitherFinding } from "./types.js";

// Check slither availability without throwing. Used once per run so the
// phase can degrade gracefully when the tool isn't installed.
export function isSlitherAvailable(): boolean {
  try {
    execSync("slither --version", {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

// Extract a solc version like "0.8.19" from Etherscan's full string
// (e.g. "v0.8.19+commit.7dd6d404").
function parseSolcVersion(compilerVersion: string | undefined): string | null {
  if (!compilerVersion) return null;
  const match = compilerVersion.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

// Best-effort solc-select switch. If solc-select isn't installed or the
// version isn't available, swallow the error — Slither will fall back to
// whatever solc is on PATH and either succeed or produce a compile error
// we'll log.
function trySelectSolc(version: string | null): void {
  if (!version) return;
  try {
    execSync(`solc-select use ${version} --always-install`, {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 60000,
    });
  } catch {
    // Silent — caller will see any compile failure in slither stderr.
  }
}

function writeSourceTree(
  files: Record<string, string>
): { dir: string; cleanup: () => void } {
  const dir = path.join(os.tmpdir(), `contractlens-slither-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  for (const [filename, content] of Object.entries(files)) {
    // Etherscan paths can contain directories and sometimes odd prefixes.
    // Strip leading slashes and any drive letters so we stay inside dir.
    const safe = filename.replace(/^[a-zA-Z]:/, "").replace(/^[/\\]+/, "");
    const full = path.join(dir, safe);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }

  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failures — tmp dir is OS-managed anyway.
      }
    },
  };
}

function normalizeSeverity(impact: string): SlitherFinding["severity"] {
  const up = (impact || "").toUpperCase();
  if (up === "HIGH") return "HIGH";
  if (up === "MEDIUM") return "MEDIUM";
  if (up === "LOW") return "LOW";
  if (up === "OPTIMIZATION") return "OPTIMIZATION";
  return "INFORMATIONAL";
}

interface SlitherDetectorJson {
  check: string;
  impact: string;
  description: string;
  elements?: Array<{
    type: string;
    name: string;
    type_specific_fields?: {
      parent?: { type: string; name: string };
    };
  }>;
  additional_fields?: { underlying_type?: string };
}

interface SlitherJsonOutput {
  success: boolean;
  results?: { detectors?: SlitherDetectorJson[] };
}

function extractFunctions(d: SlitherDetectorJson): string[] {
  if (!d.elements) return [];
  const names = new Set<string>();
  for (const el of d.elements) {
    if (el.type === "function") {
      names.add(el.name);
    } else if (el.type_specific_fields?.parent?.type === "function") {
      names.add(el.type_specific_fields.parent.name);
    }
  }
  return Array.from(names);
}

export interface SlitherRunResult {
  available: boolean;
  findings: SlitherFinding[];
  error?: string;
}

export function runSlither(
  files: Record<string, string>,
  compilerVersion: string | undefined,
  timeoutMs: number = 180000
): SlitherRunResult {
  if (!isSlitherAvailable()) {
    return { available: false, findings: [] };
  }

  trySelectSolc(parseSolcVersion(compilerVersion));

  const { dir, cleanup } = writeSourceTree(files);

  try {
    // --json - writes JSON to stdout. Slither exits nonzero when any finding
    // is reported, so we catch and parse stdout from the error object too.
    let stdout = "";
    try {
      stdout = execSync(`slither "${dir}" --json -`, {
        timeout: timeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      // Findings-present exit codes still emit JSON on stdout.
      if (e.stdout && e.stdout.trim().startsWith("{")) {
        stdout = e.stdout;
      } else {
        return {
          available: true,
          findings: [],
          error: (e.stderr || e.message || "unknown slither error").slice(
            0,
            500
          ),
        };
      }
    }

    let parsed: SlitherJsonOutput;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return {
        available: true,
        findings: [],
        error: "failed to parse slither JSON output",
      };
    }

    const detectors = parsed.results?.detectors ?? [];
    const findings: SlitherFinding[] = detectors.map((d) => ({
      detector: d.check,
      severity: normalizeSeverity(d.impact),
      description: (d.description || "").trim().slice(0, 1000),
      functions: extractFunctions(d),
    }));

    return { available: true, findings };
  } finally {
    cleanup();
  }
}
