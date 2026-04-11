import { runSlither } from "../utils/slither.js";
import type { SlitherFinding, SourceResult } from "../utils/types.js";

export interface StaticAnalysisResult {
  slither: {
    available: boolean;
    findings: SlitherFinding[];
    error?: string;
  };
}

// Runs deterministic static analysis tools against verified Solidity.
// Skipped entirely for decompiled bytecode — Slither needs real source.
// Any tool that isn't installed degrades to an empty finding list rather
// than crashing the pipeline.
export async function runStaticAnalysis(
  source: SourceResult
): Promise<StaticAnalysisResult> {
  if (source.isDecompiled || !source.files) {
    return { slither: { available: false, findings: [] } };
  }

  const slither = runSlither(source.files, source.compilerVersion, source.name);
  return { slither };
}
