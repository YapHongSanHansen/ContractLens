import { callAIJson } from "../utils/ai.js";
import type {
  ContractInventory,
  ExploitVector,
  AuditResult,
  SlitherFinding,
} from "../utils/types.js";

interface AttackerResult {
  id: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  functions: string[];
  attackScenario: string;
}

interface DefenderResult {
  id: string;
  mitigation: string;
  mitigationLevel: "NONE" | "PARTIAL" | "FULL";
}

interface VerdictResult {
  riskScore: number;
  verdict: "SAFE" | "CAUTION" | "CRITICAL";
  confidence: number;
  summary: string;
}

function formatSlitherFindings(findings: SlitherFinding[]): string {
  if (findings.length === 0) return "(none reported)";
  return findings
    .map((f, i) => {
      const fns = f.functions.length > 0 ? ` [${f.functions.join(", ")}]` : "";
      return `${i + 1}. [${f.severity}] ${f.detector}${fns}: ${f.description}`;
    })
    .join("\n");
}

export async function adversarialAudit(
  source: string,
  inventory: ContractInventory,
  isDecompiled: boolean = false,
  slitherFindings: SlitherFinding[] = []
): Promise<AuditResult> {
  // Decompiled bytecode is AI-reconstructed pseudocode — not reliable enough
  // to produce a meaningful risk score. Return an explicit low-confidence
  // "insufficient source" verdict instead of letting the pipeline pretend it
  // audited real Solidity.
  if (isDecompiled) {
    return {
      exploits: [],
      riskScore: 50,
      verdict: "CAUTION",
      confidence: 20,
      summary:
        "Contract is unverified. Analysis was performed against AI-reconstructed pseudocode from bytecode, which is not reliable for security auditing. Treat this as insufficient source and request verified source code before trusting any verdict.",
    };
  }

  // === CALL 1: ATTACKER PASS ===
  const attackerSystemPrompt = `You are a malicious smart contract auditor. Your goal is to find every possible exploit in this contract. Think like an attacker — what can the owner do to steal funds? What can a third party exploit? What edge cases exist in the math, access control, or token logic?

Return a JSON array of objects with these fields:
- id: unique string identifier (e.g. "VULN-001")
- description: what the vulnerability is
- severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
- functions: array of function names involved
- attackScenario: step-by-step description of how to exploit this

If you genuinely find no exploit vectors after a thorough review, return an empty array [].`;

  const attackerMessage = `Find all exploit vectors in this contract.

Contract Inventory:
${JSON.stringify(inventory, null, 2)}

Deterministic static analysis findings (Slither) — these were produced by a
deterministic tool, not an LLM guess. Treat them as ground truth: include
every HIGH/MEDIUM finding in your output (map to your severity scale) and
only exclude a finding if you can cite the exact code that neutralizes it.
You may also add additional vectors Slither missed.

${formatSlitherFindings(slitherFindings)}

Source Code:
\`\`\`solidity
${source}
\`\`\``;

  const attackerResults =
    (await callAIJson<AttackerResult[]>(
      attackerSystemPrompt,
      attackerMessage
    )) ?? [];

  // === CALL 2: DEFENDER PASS ===
  // Skip the defender round-trip when there's nothing to defend — the verdict
  // pass still runs so the score stays model-generated, never hardcoded.
  let defenderResults: DefenderResult[] = [];
  if (attackerResults.length > 0) {
    const defenderSystemPrompt = `You are a defensive smart contract auditor. For each exploit vector below, analyze the source code for mitigating factors: timelocks, multisigs, caps, governance requirements, access controls, reentrancy guards, or other safety mechanisms. Be specific and cite function names.

Return a JSON array where each object has:
- id: matching the exploit id
- mitigation: description of mitigating factors found (or "None found")
- mitigationLevel: "NONE" | "PARTIAL" | "FULL"`;

    const defenderMessage = `Analyze defenses for each exploit vector.

Exploit Vectors:
${JSON.stringify(attackerResults, null, 2)}

Source Code:
\`\`\`solidity
${source}
\`\`\``;

    defenderResults =
      (await callAIJson<DefenderResult[]>(
        defenderSystemPrompt,
        defenderMessage
      )) ?? [];
  }

  // === CALL 3: VERDICT PASS ===
  const verdictSystemPrompt = `You are a senior smart contract auditor making a final determination. Given the exploits found (if any) and defenses analyzed, produce a final risk assessment of the contract.

Rules:
- Base the score on the actual severity and mitigation level of findings, and on the overall contract design. Do NOT default to a fixed value.
- An empty exploit list does NOT automatically mean the contract is safe — re-read the source and decide whether the auditors missed something or the contract is genuinely clean.
- If the source looks thin, unusual, or too simple to judge, lower your confidence accordingly.
- Slither findings are deterministic ground truth from a static analyzer. Weight unmitigated HIGH/MEDIUM Slither findings more heavily than AI-only findings, and raise your confidence when Slither agrees with the adversarial pass.
- USE THE FULL 0-100 RANGE. Do not compress scores into the 50-70 band. A well-audited, immutable contract with no privileged roles deserves 85+. A contract with unrestricted owner mint or drain deserves 20-35. A contract with confirmed reentrancy that moves funds deserves 0-15.

Score anchors (calibrate against these reference points):
- 95-100: Formally verified, immutable, no owner, no external calls, trivial logic. (e.g. a pure math library)
- 80-94:  Standard well-audited primitive with minor known quirks. (e.g. WETH9, OpenZeppelin ERC20)
- 65-79:  Mostly safe but has owner role, upgradeability, or unusual mechanics that warrant review.
- 45-64:  Material concerns — unmitigated owner powers, risky external calls, or multiple medium-severity bugs.
- 25-44:  Serious issues — unrestricted owner mint/drain, missing access control, or one high-severity bug.
- 10-24:  Critical vulnerabilities with no mitigation — fund-draining exploits, broken access control.
- 0-9:    Confirmed exploit moving funds; this contract should not be trusted.

Return a JSON object with:
- riskScore: integer 0-100, where 100 means completely safe and 0 means extremely dangerous. MUST be a plain integer like 25 or 70, never a word like "fifty".
- verdict: "SAFE" (score >= 70) | "CAUTION" (score 40-69) | "CRITICAL" (score < 40)
- confidence: integer 0-100, your confidence in this assessment. MUST be a plain integer.
- summary: 2 sentences maximum summarizing the findings`;

  const enrichedExploits = attackerResults.map((a) => {
    const defense = defenderResults.find((d) => d.id === a.id);
    return {
      ...a,
      mitigation: defense?.mitigation || "Not analyzed",
      mitigationLevel: defense?.mitigationLevel || "NONE",
    };
  });

  const verdictMessage = `Produce a final risk assessment.

Contract Inventory:
${JSON.stringify(inventory, null, 2)}

Slither static analysis findings (deterministic, higher confidence than AI-only findings):
${formatSlitherFindings(slitherFindings)}

Exploit Vectors with Defenses (may be empty):
${JSON.stringify(enrichedExploits, null, 2)}

Source Code:
\`\`\`solidity
${source}
\`\`\``;

  const verdict = await callAIJson<VerdictResult>(
    verdictSystemPrompt,
    verdictMessage
  );

  // Derive verdict from score rather than trusting the model to apply its own
  // threshold — observed cases where the model returned score 75 with verdict
  // "CAUTION" even though the prompt defines SAFE as score >= 70.
  const clampedScore = Math.max(0, Math.min(100, Math.round(verdict.riskScore)));
  const derivedVerdict: "SAFE" | "CAUTION" | "CRITICAL" =
    clampedScore >= 70 ? "SAFE" : clampedScore >= 40 ? "CAUTION" : "CRITICAL";

  // Merge results
  const exploits: ExploitVector[] = attackerResults.map((a) => {
    const defense = defenderResults.find((d) => d.id === a.id);
    return {
      id: a.id,
      description: a.description,
      severity: a.severity,
      functions: a.functions,
      attackScenario: a.attackScenario,
      mitigation: defense?.mitigation || "Not analyzed",
      mitigationLevel: defense?.mitigationLevel || "NONE",
    };
  });

  return {
    exploits,
    riskScore: clampedScore,
    verdict: derivedVerdict,
    confidence: verdict.confidence,
    summary: verdict.summary,
  };
}
