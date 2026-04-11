// Read-only sidecar integration with the dcai RPC service. We fire a single
// eth_blockNumber + eth_chainId probe at the start of every audit so the
// CLI output shows dcai as a live dependency, but this function NEVER
// throws and is completely isolated from the mint/registry/badge flow —
// dcai lives on a different chain (18441) than Sepolia (11155111) where
// the badge contract is deployed, so it can't be used as a drop-in RPC
// replacement for viem's wallet clients.

export interface DcaiStatus {
  ok: true;
  chainId: number;
  blockNumber: number;
}

export interface DcaiError {
  ok: false;
  error: string;
}

const DCAI_PROBE_TIMEOUT_MS = 5000;

async function jsonRpc(
  url: string,
  method: string,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  if (typeof body.result !== "string") throw new Error("invalid JSON-RPC response");
  return body.result;
}

export async function probeDcai(): Promise<DcaiStatus | DcaiError> {
  const url = process.env.DCAI_RPC_URL?.trim();
  if (!url) return { ok: false, error: "DCAI_RPC_URL not set" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DCAI_PROBE_TIMEOUT_MS);
  try {
    const [chainIdHex, blockHex] = await Promise.all([
      jsonRpc(url, "eth_chainId", controller.signal),
      jsonRpc(url, "eth_blockNumber", controller.signal),
    ]);
    return {
      ok: true,
      chainId: parseInt(chainIdHex, 16),
      blockNumber: parseInt(blockHex, 16),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}
