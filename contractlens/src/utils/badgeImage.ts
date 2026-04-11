import { readFileSync } from "fs";
import path from "path";
import OpenAI from "openai";
import { PinataSDK } from "pinata";
import {
  renderLevel2Svg,
  svgToDataUri,
  type BadgeMetadataInput,
} from "./badgeMetadata.js";

export type ImageMethod = "ai-dalle3" | "svg-level2" | "custom-file";

export interface BadgeImageResult {
  imageUri: string;
  method: ImageMethod;
}

// Hard ceiling on AI image generation so a slow or hanging API call can't
// stall the demo. DALL-E 3 usually returns in 10-20s; we give it 45.
const AI_IMAGE_TIMEOUT_MS = 45000;

// Fully synchronous, deterministic fallback — always succeeds.
function buildSvgFallback(input: BadgeMetadataInput): BadgeImageResult {
  const svg = renderLevel2Svg(input);
  return { imageUri: svgToDataUri(svg), method: "svg-level2" };
}

// Build a deterministic prompt for DALL-E 3 based on the audit data.
function buildPrompt(input: BadgeMetadataInput): string {
  const tierDescriptions: Record<string, { color: string; mood: string }> = {
    SAFE: { color: "emerald green", mood: "trustworthy, verified, pristine" },
    CAUTION: { color: "amber yellow", mood: "watchful, cautious, alert" },
    CRITICAL: { color: "crimson red", mood: "dangerous, warning, critical" },
  };
  const tier = input.verdict.toUpperCase();
  const t = tierDescriptions[tier] ?? tierDescriptions.CAUTION;

  return `A hexagonal blockchain security audit badge crest, flat vector illustration style, ${t.color} accent color on a deep navy background. Minimalist cybersecurity aesthetic with glowing circuit-board patterns, geometric shield at the center containing an abstract cryptographic symbol. Mood: ${t.mood}. No text, no letters, no watermarks, no logos, no people. Highly symmetric, professional, premium collectible NFT artwork, clean vector lines, subtle neon glow effects, dark background only.`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

async function pinImageBytesToIpfs(
  bytes: Buffer,
  filename: string,
  mime: string,
  contractAddress: string,
  kind: string
): Promise<string> {
  const sdk = new PinataSDK({
    pinataJwt: process.env.PINATA_API_KEY || "",
    pinataGateway: "gateway.pinata.cloud",
  });

  const file = new File([new Uint8Array(bytes)], filename, { type: mime });

  const result = await sdk.upload.public
    .file(file)
    .name(`ContractLens Badge Image - ${contractAddress}`)
    .keyvalues({
      contract: contractAddress,
      tool: "contractlens",
      kind,
    });

  // Return the HTTPS gateway URL, not ipfs:// — Etherscan's Sepolia NFT
  // renderer silently falls back to a placeholder when it can't resolve
  // ipfs:// via its default gateway.
  return `https://gateway.pinata.cloud/ipfs/${result.cid}`;
}

// Reads a local image file from BADGE_CUSTOM_IMAGE_PATH and pins it to
// Pinata. Returns the HTTPS gateway URL, or null if the env var isn't set
// or the file can't be read.
async function tryCustomImage(
  input: BadgeMetadataInput
): Promise<BadgeImageResult | null> {
  const customPath = process.env.BADGE_CUSTOM_IMAGE_PATH?.trim();
  if (!customPath) return null;

  const pinataKey = process.env.PINATA_API_KEY?.trim();
  if (!pinataKey) return null;

  const absPath = path.isAbsolute(customPath)
    ? customPath
    : path.resolve(process.cwd(), customPath);
  const bytes = readFileSync(absPath);
  const ext = path.extname(absPath);
  const mime = mimeFromExt(ext);
  const filename = `contractlens-badge-custom-${input.contractAddress}${ext || ".png"}`;

  const imageUrl = await pinImageBytesToIpfs(
    bytes,
    filename,
    mime,
    input.contractAddress,
    "badge-image-custom"
  );

  return { imageUri: imageUrl, method: "custom-file" };
}

async function tryGenerateAiImage(
  input: BadgeMetadataInput
): Promise<BadgeImageResult | null> {
  // Opt-out switch so the user can force SVG mode without code changes.
  if (process.env.BADGE_AI_IMAGES === "false") return null;

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) return null;
  const pinataKey = process.env.PINATA_API_KEY?.trim();
  if (!pinataKey) return null;

  const openai = new OpenAI({ apiKey: openaiKey });
  const prompt = buildPrompt(input);

  // Ask DALL-E 3 for a base64 PNG, then pin it to IPFS as a separate file
  // and reference it from metadata via an HTTPS gateway URL. Inlining the
  // PNG as a 1.4 MB data URI works for MetaMask but Etherscan's Sepolia NFT
  // renderer has a data URI size limit and refuses to render it.
  const response = await withTimeout(
    openai.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      quality: "standard",
      style: "vivid",
      response_format: "b64_json",
    }),
    AI_IMAGE_TIMEOUT_MS
  );

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) return null;

  const imageUrl = await pinImageBytesToIpfs(
    Buffer.from(b64, "base64"),
    `contractlens-badge-${input.contractAddress}.png`,
    "image/png",
    input.contractAddress,
    "badge-image"
  );

  return {
    imageUri: imageUrl,
    method: "ai-dalle3",
  };
}

/// Produces the image URI for the badge metadata. Resolution order:
///   1. BADGE_CUSTOM_IMAGE_PATH — user-supplied local image, pinned to IPFS
///   2. DALL·E 3 — AI-generated art, pinned to IPFS
///   3. Level 2 SVG — deterministic, embedded as a data URI (always succeeds)
/// Any failure in steps 1 or 2 silently falls through. This function never
/// throws — the SVG fallback is pure string interpolation and can't fail.
export async function generateBadgeImageUri(
  input: BadgeMetadataInput
): Promise<BadgeImageResult> {
  try {
    const custom = await tryCustomImage(input);
    if (custom) return custom;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠ Custom badge image unavailable (${msg.slice(0, 120)}) — trying AI`);
  }

  try {
    const ai = await tryGenerateAiImage(input);
    if (ai) return ai;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ⚠ AI badge art unavailable (${msg.slice(0, 120)}) — using SVG fallback`);
  }
  return buildSvgFallback(input);
}
