export interface EtherscanSourceResponse {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  ConstructorArguments: string;
  EVMVersion: string;
  Library: string;
  LicenseType: string;
  Proxy: string;
  Implementation: string;
  SwarmSource: string;
}

function getEtherscanChainId(chain: string): number {
  switch (chain.toLowerCase()) {
    case "ethereum":
    case "mainnet":
      return 1;
    case "sepolia":
      return 11155111;
    default:
      throw new Error(
        `Unsupported chain "${chain}". Supported: ethereum, sepolia.`
      );
  }
}

export async function fetchVerifiedSource(
  address: string,
  apiKey: string,
  chain: string = "ethereum"
): Promise<EtherscanSourceResponse | null> {
  // Etherscan deprecated the legacy per-chain V1 hosts in 2025; everything now
  // goes through the V2 multichain endpoint with an explicit chainid param.
  const chainId = getEtherscanChainId(chain);
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=contract&action=getsourcecode&address=${encodeURIComponent(address)}&apikey=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url);
  const data = (await response.json()) as {
    status: string;
    message?: string;
    result?: EtherscanSourceResponse[] | string;
  };

  if (data.status !== "1" || !Array.isArray(data.result) || data.result.length === 0) {
    const reason =
      typeof data.result === "string"
        ? data.result
        : data.message || "unknown error";
    throw new Error(`Etherscan V2 getsourcecode failed: ${reason}`);
  }

  const result = data.result[0];

  // If SourceCode is empty, contract is not verified
  if (!result.SourceCode || result.SourceCode === "") {
    return null;
  }

  return result;
}

export function flattenMultiFileSource(sourceCode: string): string {
  // Etherscan wraps multi-file sources in double braces: {{...}}
  if (sourceCode.startsWith("{{") && sourceCode.endsWith("}}")) {
    try {
      const inner = sourceCode.slice(1, -1); // Remove outer braces
      const parsed = JSON.parse(inner);
      const sources = parsed.sources || parsed;
      const parts: string[] = [];

      for (const [filename, fileData] of Object.entries(sources)) {
        const content = (fileData as { content: string }).content;
        parts.push(`// === ${filename} ===\n${content}`);
      }

      return parts.join("\n\n");
    } catch {
      return sourceCode;
    }
  }

  // Single-file source or already flattened
  if (sourceCode.startsWith("{")) {
    try {
      const parsed = JSON.parse(sourceCode);
      const sources = parsed.sources || parsed;
      const parts: string[] = [];

      for (const [filename, fileData] of Object.entries(sources)) {
        const content = (fileData as { content: string }).content;
        parts.push(`// === ${filename} ===\n${content}`);
      }

      return parts.join("\n\n");
    } catch {
      return sourceCode;
    }
  }

  return sourceCode;
}
