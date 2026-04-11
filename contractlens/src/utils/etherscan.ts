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

// Parses an Etherscan SourceCode field into a {path: content} map.
// Etherscan returns three shapes: plain Solidity, single-brace JSON
// {sources: {...}}, and double-brace standard-json-input {{...}}.
// Returns null if the field is plain Solidity (caller should treat the
// whole thing as one file).
export function parseMultiFileSource(
  sourceCode: string
): Record<string, string> | null {
  let jsonText: string | null = null;

  if (sourceCode.startsWith("{{") && sourceCode.endsWith("}}")) {
    jsonText = sourceCode.slice(1, -1);
  } else if (sourceCode.startsWith("{")) {
    jsonText = sourceCode;
  }

  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    const sources = parsed.sources || parsed;
    const out: Record<string, string> = {};
    for (const [filename, fileData] of Object.entries(sources)) {
      const content = (fileData as { content?: string }).content;
      if (typeof content === "string") {
        out[filename] = content;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function flattenMultiFileSource(sourceCode: string): string {
  const files = parseMultiFileSource(sourceCode);
  if (!files) return sourceCode;
  return Object.entries(files)
    .map(([filename, content]) => `// === ${filename} ===\n${content}`)
    .join("\n\n");
}
