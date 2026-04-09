import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import {
  fetchVerifiedSource,
  flattenMultiFileSource,
} from "../utils/etherscan.js";
import { callAI } from "../utils/ai.js";
import type { SourceResult } from "../utils/types.js";

export async function fetchSource(address: string): Promise<SourceResult> {
  const etherscanKey = process.env.ETHERSCAN_API_KEY;
  if (!etherscanKey) {
    throw new Error("ETHERSCAN_API_KEY is required in .env");
  }

  // Step 1: Try Etherscan verified source
  const verified = await fetchVerifiedSource(address, etherscanKey);

  if (verified) {
    const source = flattenMultiFileSource(verified.SourceCode);
    return {
      source,
      name: verified.ContractName || "Unknown",
      isDecompiled: false,
    };
  }

  // Step 2: Fetch bytecode and decompile via AI
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("RPC_URL is required in .env for unverified contracts");
  }

  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });

  const bytecode = await client.getCode({
    address: address as `0x${string}`,
  });

  if (!bytecode || bytecode === "0x") {
    throw new Error(
      `Address ${address} has no code — it is an EOA (externally owned account), not a contract.`
    );
  }

  // Truncate bytecode if very long to fit in AI context
  const maxBytecodeLen = 12000;
  const truncatedBytecode =
    bytecode.length > maxBytecodeLen
      ? bytecode.slice(0, maxBytecodeLen) + "..."
      : bytecode;

  const decompiled = await callAI(
    "You are a Solidity decompiler. Given this EVM bytecode, reconstruct readable Solidity-like pseudocode showing all functions, their selectors, storage slots, and logic. Output clean Solidity-style code.",
    `Decompile this EVM bytecode into readable Solidity pseudocode:\n\n${truncatedBytecode}`
  );

  return {
    source: decompiled,
    name: "Unverified Contract",
    isDecompiled: true,
  };
}
