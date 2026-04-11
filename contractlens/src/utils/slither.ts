import { execSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
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
      shell: "cmd.exe",
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

// Best-effort solc-select switch. Returns a diagnostic string describing
// what happened so the caller can include it in any downstream error.
function trySelectSolc(version: string | null): string {
  if (!version) return "no compiler version supplied";
  try {
    execSync(`solc-select use ${version} --always-install`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
      shell: "cmd.exe",
    });
    return `solc-select use ${version} ok`;
  } catch (err) {
    const e = err as { stderr?: Buffer; stdout?: Buffer; message: string };
    const stderr = e.stderr?.toString().trim() || "";
    const stdout = e.stdout?.toString().trim() || "";
    return `solc-select use ${version} failed: ${stderr || stdout || e.message}`.slice(0, 300);
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

// Pick the file we'll hand to slither. Slither via crytic-compile's Foundry
// platform detector crashes with `assert project_root is not None` when given
// a directory on Windows, so we target a specific .sol file instead — solc
// follows relative imports from there. We prefer a file whose basename or
// contract name matches `contractName`, falling back to the first .sol file
// that isn't obviously an interface/library.
function pickEntryFile(
  dir: string,
  files: Record<string, string>,
  contractName: string | undefined
): string | null {
  const solFiles = Object.keys(files).filter((f) => f.endsWith(".sol"));
  if (solFiles.length === 0) return null;

  const normalize = (s: string) => s.replace(/^[a-zA-Z]:/, "").replace(/^[/\\]+/, "");
  const toAbs = (f: string) => path.join(dir, normalize(f));

  if (contractName) {
    const byBasename = solFiles.find(
      (f) => path.basename(f, ".sol").toLowerCase() === contractName.toLowerCase()
    );
    if (byBasename) return toAbs(byBasename);

    const contractRegex = new RegExp(`\\bcontract\\s+${contractName}\\b`);
    const byContents = solFiles.find((f) => contractRegex.test(files[f]));
    if (byContents) return toAbs(byContents);
  }

  return toAbs(solFiles[0]);
}

export function runSlither(
  files: Record<string, string>,
  compilerVersion: string | undefined,
  contractName?: string,
  timeoutMs: number = 180000
): SlitherRunResult {
  if (!isSlitherAvailable()) {
    return { available: false, findings: [] };
  }

  const solcDiag = trySelectSolc(parseSolcVersion(compilerVersion));

  const { dir, cleanup } = writeSourceTree(files);
  const entryFile = pickEntryFile(dir, files, contractName);
  if (!entryFile) {
    cleanup();
    return {
      available: true,
      findings: [],
      error: "no .sol files found in source tree",
    };
  }

  // Write slither JSON to a file instead of stdout. On Windows, slither.exe's
  // Python subprocess output gets swallowed when stdio is piped via Node's
  // execSync — but a file write always works. Unique name so concurrent runs
  // don't stomp on each other.
  const jsonPath = path.join(
    os.tmpdir(),
    `contractlens-slither-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`
  );

  try {
    try {
      execSync(`slither "${entryFile}" --json "${jsonPath}"`, {
        timeout: timeoutMs,
        stdio: ["ignore", "ignore", "ignore"],
        maxBuffer: 20 * 1024 * 1024,
        shell: "cmd.exe",
        cwd: dir,
        env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
      });
    } catch (err: unknown) {
      // Slither exits nonzero when any finding is reported — but the JSON
      // file is still written. Only treat this as a crash if the file is
      // missing or empty.
      const e = err as { message: string };
      if (!existsSync(jsonPath)) {
        return {
          available: true,
          findings: [],
          error: `slither crashed (${solcDiag}): ${e.message || "no output"}`.slice(0, 800),
        };
      }
    }

    if (!existsSync(jsonPath)) {
      return {
        available: true,
        findings: [],
        error: `slither produced no output (${solcDiag})`,
      };
    }

    const raw = readFileSync(jsonPath, "utf-8");
    try {
      rmSync(jsonPath, { force: true });
    } catch {
      // Ignore cleanup failure
    }

    if (!raw.trim()) {
      return {
        available: true,
        findings: [],
        error: "slither wrote an empty JSON file",
      };
    }

    let parsed: SlitherJsonOutput;
    try {
      parsed = JSON.parse(raw);
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
