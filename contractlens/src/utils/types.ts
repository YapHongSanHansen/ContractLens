export interface ContractInventory {
  name: string;
  type: string;
  functions: Array<{
    name: string;
    visibility: "public" | "external" | "internal" | "private";
    onlyOwner: boolean;
    modifiers: string[];
  }>;
  ownerControls: string[];
  isUpgradeable: boolean;
  proxyPattern: string | null;
  externalCalls: Array<{ target: string; function: string }>;
  tokenTax: { percent: string; recipient: string } | null;
  supplyInfo: { max: string; mintable: boolean; burnable: boolean } | null;
}

export interface ExploitVector {
  id: string;
  description: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  functions: string[];
  attackScenario: string;
  mitigation: string;
  mitigationLevel: "NONE" | "PARTIAL" | "FULL";
}

export interface AuditResult {
  exploits: ExploitVector[];
  riskScore: number;
  verdict: "SAFE" | "CAUTION" | "CRITICAL";
  confidence: number;
  summary: string;
}

export interface ExploitTestResult {
  exploitId: string;
  testCode: string;
  compiled: boolean;
  passed: boolean;
  output: string;
}

export interface SourceResult {
  source: string;
  name: string;
  isDecompiled: boolean;
  // Raw per-file source map, preserving the original paths Etherscan returned.
  // Slither needs a proper tree (to resolve imports); the flattened `source`
  // field is only suitable for the LLM.
  files?: Record<string, string>;
  compilerVersion?: string;
}

export interface SlitherFinding {
  detector: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL" | "OPTIMIZATION";
  description: string;
  functions: string[];
  swcId?: string;
}

export interface PublishResult {
  ipfsCid: string;
  txHash: string;
}
