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
}

export interface PublishResult {
  ipfsCid: string;
  txHash: string;
}
