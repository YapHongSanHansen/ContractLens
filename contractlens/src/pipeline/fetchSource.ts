import { readFileSync } from "fs";
import { basename, resolve } from "path";
import { createPublicClient, http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import {
  fetchVerifiedSource,
  flattenMultiFileSource,
  parseMultiFileSource,
} from "../utils/etherscan.js";
import { callAI } from "../utils/ai.js";
import type { SourceResult } from "../utils/types.js";

function resolveViemChain(chain: string) {
  switch (chain.toLowerCase()) {
    case "ethereum":
    case "mainnet":
      return mainnet;
    case "sepolia":
      return sepolia;
    default:
      throw new Error(
        `Unsupported chain "${chain}". Supported: ethereum, sepolia.`
      );
  }
}

export async function fetchSource(
  address: string,
  chain: string = "ethereum",
  filePath?: string
): Promise<SourceResult> {
  if (filePath) {
    const absPath = resolve(filePath);
    const source = readFileSync(absPath, "utf8");
    const fileName = basename(absPath);
    const match = source.match(
      /^\s*(?:abstract\s+)?contract\s+([A-Za-z_][A-Za-z0-9_]*)/m
    );
    const name = match?.[1] || fileName.replace(/\.sol$/, "");
    return {
      source,
      name,
      isDecompiled: false,
      files: { [fileName]: source },
    };
  }

  const etherscanKey = process.env.ETHERSCAN_API_KEY;
  if (!etherscanKey) {
    throw new Error("ETHERSCAN_API_KEY is required in .env");
  }

  // Step 1: Try Etherscan verified source. A network/API failure here is
  // different from "contract is unverified" — only the latter should fall
  // through to decompilation. A thrown error means Etherscan itself rejected
  // the call (e.g. bad key, deprecated endpoint) and must be surfaced.
  let verified;
  try {
    verified = await fetchVerifiedSource(address, etherscanKey, chain);
  } catch (err) {
    throw new Error(
      `Etherscan lookup failed for ${address} on ${chain}: ${err instanceof Error ? err.message : err}`
    );
  }

  if (verified) {
    const source = flattenMultiFileSource(verified.SourceCode);
    const parsed = parseMultiFileSource(verified.SourceCode);
    const files =
      parsed ??
      { [`${verified.ContractName || "Contract"}.sol`]: verified.SourceCode };
    return {
      source,
      name: verified.ContractName || "Unknown",
      isDecompiled: false,
      files,
      compilerVersion: verified.CompilerVersion || undefined,
    };
  }

  // Step 2: Fetch bytecode and decompile via AI
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("RPC_URL is required in .env for unverified contracts");
  }

  const client = createPublicClient({
    chain: resolveViemChain(chain),
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
