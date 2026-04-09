import { callAIJson } from "../utils/ai.js";
import type { ContractInventory } from "../utils/types.js";

const SYSTEM_PROMPT = `You are an expert smart contract analyst. Analyze the provided Solidity source code and extract a structured inventory. Return a JSON object with exactly this shape:

{
  "name": "string - contract name",
  "type": "string - ERC-20, ERC-721, DEX, Lending, Governance, custom, proxy, etc.",
  "functions": [
    {
      "name": "string",
      "visibility": "public" | "external" | "internal" | "private",
      "onlyOwner": boolean,
      "modifiers": ["string"]
    }
  ],
  "ownerControls": ["string - list of privileged functions only owner can call"],
  "isUpgradeable": boolean,
  "proxyPattern": "string | null - e.g. TransparentProxy, UUPS, Beacon, or null",
  "externalCalls": [{ "target": "string", "function": "string" }],
  "tokenTax": { "percent": "string", "recipient": "string" } | null,
  "supplyInfo": { "max": "string", "mintable": boolean, "burnable": boolean } | null
}

Be thorough. Detect all onlyOwner or access-controlled functions. Identify proxy patterns by looking for delegatecall, implementation slots, or upgrade functions. Detect token taxes by looking for fee deductions in transfer functions.`;

export async function analyzeStructure(
  source: string,
  contractName: string
): Promise<ContractInventory> {
  const userMessage = `Analyze this smart contract and return the structured inventory as JSON.\n\nContract Name: ${contractName}\n\nSource Code:\n\`\`\`solidity\n${source}\n\`\`\``;

  const result = await callAIJson<ContractInventory>(SYSTEM_PROMPT, userMessage);

  // Basic validation
  if (!result.name) result.name = contractName;
  if (!result.functions) result.functions = [];
  if (!result.ownerControls) result.ownerControls = [];
  if (!Array.isArray(result.externalCalls)) result.externalCalls = [];

  return result;
}
