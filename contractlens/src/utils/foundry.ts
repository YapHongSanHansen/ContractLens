import { execSync } from "child_process";
import { writeFileSync, mkdirSync, unlinkSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SANDBOX_DIR = path.resolve(__dirname, "../../foundry-sandbox");
const TEST_DIR = path.join(SANDBOX_DIR, "test");

export function writeExploitTest(id: string, code: string): string {
  mkdirSync(TEST_DIR, { recursive: true });
  const filePath = path.join(TEST_DIR, `Exploit_${id}.t.sol`);
  writeFileSync(filePath, code, "utf-8");
  return filePath;
}

export interface ForgeTestResult {
  compiled: boolean;
  passed: boolean;
  output: string;
}

export function runForgeTest(
  id: string,
  rpcUrl: string,
  timeoutMs: number = 90000
): ForgeTestResult {
  const cmd = `forge test --match-contract Exploit_${id} --fork-url ${rpcUrl} -vvv --no-match-path "script/*"`;

  try {
    const output = execSync(cmd, {
      cwd: SANDBOX_DIR,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, RPC_URL: rpcUrl },
    });

    const passed = output.includes("PASS");
    return { compiled: true, passed, output };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message: string };
    const stdout = error.stdout || "";
    const stderr = error.stderr || "";
    const combined = stdout + "\n" + stderr;

    // Check if it's a compilation error vs test failure
    const isCompileError =
      combined.includes("Compiler run failed") ||
      combined.includes("Error (") ||
      combined.includes("ParserError") ||
      combined.includes("TypeError");

    if (isCompileError) {
      return { compiled: false, passed: false, output: combined };
    }

    // Test ran but failed (exploit not confirmed)
    return {
      compiled: true,
      passed: combined.includes("PASS"),
      output: combined,
    };
  }
}

export function cleanupTest(id: string): void {
  const filePath = path.join(TEST_DIR, `Exploit_${id}.t.sol`);
  try {
    unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors
  }
}
