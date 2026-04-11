import { PinataSDK } from "pinata";
import { generateBadgeImageUri } from "./badgeImage.js";

type Tier = "SAFE" | "CAUTION" | "CRITICAL";

interface TierPalette {
  base: string;
  accent: string;
  glow: string;
  label: string;
  muted: string;
}

const TIER_PALETTE: Record<Tier, TierPalette> = {
  SAFE: {
    base: "#0a2d1a",
    accent: "#22c55e",
    glow: "#4ade80",
    label: "#86efac",
    muted: "#16a34a",
  },
  CAUTION: {
    base: "#2d220a",
    accent: "#eab308",
    glow: "#facc15",
    label: "#fde047",
    muted: "#ca8a04",
  },
  CRITICAL: {
    base: "#2d0a0a",
    accent: "#ef4444",
    glow: "#f87171",
    label: "#fca5a5",
    muted: "#dc2626",
  },
};

function verdictToTier(verdict: string): Tier {
  const v = verdict.toUpperCase();
  if (v === "SAFE" || v === "CAUTION" || v === "CRITICAL") return v;
  return "CAUTION";
}

// Deterministic per-contract hue offset so two audits of different contracts
// in the same tier still look visually distinct. Address bytes -> 0-359 degrees.
function hueFromAddress(address: string): number {
  const clean = address.replace(/^0x/, "").slice(0, 8);
  let acc = 0;
  for (const ch of clean) acc = (acc * 31 + ch.charCodeAt(0)) >>> 0;
  return acc % 360;
}

function truncateMiddle(s: string, head: number = 6, tail: number = 4): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface BadgeMetadataInput {
  contractName: string;
  contractAddress: string;
  contractType?: string;
  verdict: string;
  riskScore: number;
  confidence: number;
  exploitCount?: number;
  confirmedExploits?: number;
  reportCid: string;
  chain: string;
}

// Pure-SVG Level 2 badge — determinstic, per-contract colored, info-rich.
// Rendered at 640x640 for crisp display in MetaMask and Etherscan.
export function renderLevel2Svg(input: BadgeMetadataInput): string {
  const tier = verdictToTier(input.verdict);
  const p = TIER_PALETTE[tier];
  const hue = hueFromAddress(input.contractAddress);
  const name = escapeXml(input.contractName.slice(0, 22));
  const type = escapeXml((input.contractType || "CONTRACT").slice(0, 16).toUpperCase());
  const addr = truncateMiddle(input.contractAddress);
  const date = new Date().toISOString().slice(0, 10);
  const score = Math.max(0, Math.min(100, input.riskScore));
  const exploitCount = input.exploitCount ?? 0;
  const confirmed = input.confirmedExploits ?? 0;

  // Score arc geometry (circle radius 80, centered at 320,300)
  const arcCx = 320;
  const arcCy = 310;
  const arcR = 86;
  const arcLen = 2 * Math.PI * arcR;
  const arcDash = (score / 100) * arcLen;
  const arcGap = arcLen - arcDash;

  // Exploit pips (max 5 visible, gray out if none)
  const pipCount = Math.min(5, Math.max(exploitCount, 1));
  const pipStartX = 320 - ((pipCount - 1) * 18) / 2;
  const pips = Array.from({ length: pipCount }, (_, i) => {
    const filled = i < confirmed ? p.accent : i < exploitCount ? p.muted : "#334155";
    return `<circle cx="${pipStartX + i * 18}" cy="556" r="5" fill="${filled}"/>`;
  }).join("");

  // Hex grid background — scatter of tiny hexagons tinted by contract hue
  const hexDots: string[] = [];
  for (let i = 0; i < 12; i++) {
    const x = ((i * 73 + hue) % 580) + 30;
    const y = ((i * 127 + hue * 3) % 560) + 40;
    hexDots.push(`<circle cx="${x}" cy="${y}" r="1.2" fill="hsl(${hue} 60% 30%)" opacity="0.5"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%">
      <stop offset="0" stop-color="${p.base}"/>
      <stop offset="0.6" stop-color="#050a14"/>
      <stop offset="1" stop-color="#000"/>
    </radialGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.accent}"/>
      <stop offset="0.5" stop-color="hsl(${hue} 70% 55%)"/>
      <stop offset="1" stop-color="${p.accent}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="10" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="640" height="640" fill="url(#bg)"/>
  ${hexDots.join("")}

  <!-- Hex shield frame -->
  <polygon points="320,40 565,175 565,465 320,600 75,465 75,175"
           fill="none" stroke="url(#frame)" stroke-width="4" filter="url(#softGlow)"/>
  <polygon points="320,60 545,185 545,455 320,580 95,455 95,185"
           fill="#050a14" fill-opacity="0.7" stroke="${p.muted}" stroke-width="1"/>

  <!-- Header -->
  <text x="320" y="120" text-anchor="middle" font-family="monospace" font-size="20"
        fill="${p.label}" font-weight="bold" letter-spacing="4">CONTRACTLENS</text>
  <text x="320" y="145" text-anchor="middle" font-family="monospace" font-size="11"
        fill="#64748b" letter-spacing="2">ON-CHAIN AUDIT CREDENTIAL</text>

  <!-- Score arc -->
  <circle cx="${arcCx}" cy="${arcCy}" r="${arcR}" fill="none"
          stroke="#1e293b" stroke-width="10"/>
  <circle cx="${arcCx}" cy="${arcCy}" r="${arcR}" fill="none"
          stroke="${p.accent}" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${arcDash} ${arcGap}"
          transform="rotate(-90 ${arcCx} ${arcCy})" filter="url(#glow)"/>

  <!-- Score + tier (centered in arc) -->
  <text x="${arcCx}" y="${arcCy - 6}" text-anchor="middle" font-family="monospace"
        font-size="56" fill="#fff" font-weight="bold">${score}</text>
  <text x="${arcCx}" y="${arcCy + 24}" text-anchor="middle" font-family="monospace"
        font-size="14" fill="#94a3b8">/ 100</text>

  <!-- Tier label -->
  <rect x="240" y="420" width="160" height="36" rx="18"
        fill="${p.accent}" fill-opacity="0.15" stroke="${p.accent}" stroke-width="1.5"/>
  <text x="320" y="445" text-anchor="middle" font-family="monospace" font-size="22"
        fill="${p.glow}" font-weight="bold" letter-spacing="3">${tier}</text>

  <!-- Contract name -->
  <text x="320" y="490" text-anchor="middle" font-family="monospace" font-size="20"
        fill="#e2e8f0" font-weight="bold">${name}</text>

  <!-- Type pill + address -->
  <text x="320" y="512" text-anchor="middle" font-family="monospace" font-size="11"
        fill="hsl(${hue} 60% 65%)" letter-spacing="1">${type} · ${addr}</text>

  <!-- Exploit indicator row -->
  <text x="320" y="544" text-anchor="middle" font-family="monospace" font-size="9"
        fill="#64748b" letter-spacing="1">EXPLOITS FOUND · ${exploitCount} · CONFIRMED · ${confirmed}</text>
  ${pips}

  <!-- Footer -->
  <text x="320" y="595" text-anchor="middle" font-family="monospace" font-size="9"
        fill="#475569" letter-spacing="2">VERIFIED · ${date} · ${input.chain.toUpperCase()}</text>
</svg>`;
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

export interface PinnedBadge {
  tokenUri: string;
  imageMethod: "ai-dalle3" | "svg-level2" | "custom-file";
}

// Pins an ERC-721 metadata JSON for the badge and returns a public HTTPS
// gateway URL (not ipfs://). Sepolia Etherscan's IPFS resolver is flaky and
// shows a generic NFT placeholder when it can't fetch metadata — HTTPS URLs
// work reliably. Tries AI image generation first; falls back to embedded
// Level 2 SVG if AI generation fails for any reason.
export async function pinBadgeMetadata(input: BadgeMetadataInput): Promise<PinnedBadge> {
  const tier = verdictToTier(input.verdict);

  // 1. Obtain the image URI — AI-generated or Level 2 SVG fallback.
  const { imageUri, method } = await generateBadgeImageUri(input);

  const metadata = {
    name: `ContractLens ${tier} — ${input.contractName}`,
    description: `ContractLens AI security audit for ${input.contractName} (${input.contractAddress}) on ${input.chain}. Verdict: ${tier}. Risk score: ${input.riskScore}/100. Confidence: ${input.confidence}%. Full report: ipfs://${input.reportCid}`,
    image: imageUri,
    external_url: `https://ipfs.io/ipfs/${input.reportCid}`,
    attributes: [
      { trait_type: "Verdict", value: tier },
      { trait_type: "Risk Score", value: input.riskScore, max_value: 100 },
      { trait_type: "Confidence", value: input.confidence, max_value: 100 },
      { trait_type: "Contract Type", value: input.contractType || "Unknown" },
      { trait_type: "Exploits Found", value: input.exploitCount ?? 0 },
      { trait_type: "Confirmed Exploits", value: input.confirmedExploits ?? 0 },
      { trait_type: "Audited Contract", value: input.contractAddress },
      { trait_type: "Chain", value: input.chain },
      { trait_type: "Art Method", value: method },
      { trait_type: "Audited At", display_type: "date", value: Math.floor(Date.now() / 1000) },
    ],
  };

  const sdk = new PinataSDK({
    pinataJwt: process.env.PINATA_API_KEY || "",
    pinataGateway: "gateway.pinata.cloud",
  });

  const file = new File(
    [JSON.stringify(metadata)],
    `contractlens-badge-${input.contractAddress}.json`,
    { type: "application/json" }
  );

  const result = await sdk.upload.public
    .file(file)
    .name(`ContractLens Badge - ${input.contractAddress}`)
    .keyvalues({
      contract: input.contractAddress,
      tool: "contractlens",
      kind: "badge-metadata",
      tier,
      artMethod: method,
    });

  return {
    tokenUri: `https://gateway.pinata.cloud/ipfs/${result.cid}`,
    imageMethod: method,
  };
}
