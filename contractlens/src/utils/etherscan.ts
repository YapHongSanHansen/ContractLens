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

export async function fetchVerifiedSource(
  address: string,
  apiKey: string
): Promise<EtherscanSourceResponse | null> {
  const url = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== "1" || !data.result || data.result.length === 0) {
    return null;
  }

  const result = data.result[0] as EtherscanSourceResponse;

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
