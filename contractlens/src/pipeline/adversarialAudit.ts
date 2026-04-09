import { callAIJson } from "../utils/ai.js";
import type {
  ContractInventory,
  ExploitVector,
  AuditResult,
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

export async function adversarialAudit(
  source: string,
  inventory: ContractInventory
): Promise<AuditResult> {
  // === CALL 1: ATTACKER PASS ===
  const attackerSystemPrompt = `You are a malicious smart contract auditor. Your goal is to find every possible exploit in this contract. Think like an attacker — what can the owner do to steal funds? What can a third party exploit? What edge cases exist in the math, access control, or token logic?

Return a JSON array of objects with these fields:
- id: unique string identifier (e.g. "VULN-001")
- description: what the vulnerability is
- severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
- functions: array of function names involved
- attackScenario: step-by-step description of how to exploit this`;

  const attackerMessage = `Find all exploit vectors in this contract.

Contract Inventory:
${JSON.stringify(inventory, null, 2)}

Source Code:
\`\`\`solidity
${source}
\`\`\``;

  const attackerResults = await callAIJson<AttackerResult[]>(
    attackerSystemPrompt,
    attackerMessage
  );

  if (!attackerResults || attackerResults.length === 0) {
    return {
      exploits: [],
      riskScore: 95,
      verdict: "SAFE",
      confidence: 70,
      summary:
        "No exploit vectors were identified in this contract. The code appears to follow standard patterns.",
    };
  }

  // === CALL 2: DEFENDER PASS ===
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

  const defenderResults = await callAIJson<DefenderResult[]>(
    defenderSystemPrompt,
    defenderMessage
  );

  // === CALL 3: VERDICT PASS ===
  const verdictSystemPrompt = `You are a senior smart contract auditor making a final determination. Given the exploits found and defenses analyzed, produce a final risk assessment.

Return a JSON object with:
- riskScore: 0-100, where 100 means completely safe and 0 means extremely dangerous
- verdict: "SAFE" (score >= 70) | "CAUTION" (score 40-69) | "CRITICAL" (score < 40)
- confidence: 0-100, your confidence in this assessment
- summary: 2 sentences maximum summarizing the findings`;

  const verdictMessage = `Produce a final risk assessment.

Exploit Vectors with Defenses:
${JSON.stringify(
  attackerResults.map((a) => {
    const defense = defenderResults.find((d) => d.id === a.id);
    return {
      ...a,
      mitigation: defense?.mitigation || "Not analyzed",
      mitigationLevel: defense?.mitigationLevel || "NONE",
    };
  }),
  null,
  2
)}`;

  const verdict = await callAIJson<VerdictResult>(
    verdictSystemPrompt,
    verdictMessage
  );

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
    riskScore: verdict.riskScore,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    summary: verdict.summary,
  };
}
