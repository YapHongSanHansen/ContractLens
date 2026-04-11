import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

let client: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// Fixed seed + temperature 0 makes the adversarial audit reproducible.
// Without this, the same contract can swing 20+ risk-score points between
// runs because OpenAI defaults to temperature 1.0.
const DETERMINISM_SEED = 42;

type Provider = "anthropic" | "openai";

function resolveProvider(): Provider {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (explicit === "anthropic" || explicit === "openai") {
    const key = explicit === "anthropic" ? anthropicKey : openaiKey;
    if (!key) {
      throw new Error(
        `AI_PROVIDER=${explicit} but ${explicit === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} is not set.`
      );
    }
    return explicit;
  }

  if (anthropicKey) return "anthropic";
  if (openaiKey) return "openai";
  throw new Error(
    "Missing AI API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your .env."
  );
}

export async function callAI(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const provider = resolveProvider();

  if (provider === "anthropic") {
    const anthropic = getClient();
    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const block = response.content[0];
    if (block.type === "text") {
      return block.text;
    }
    throw new Error("Unexpected response type from Anthropic API");
  }

  {
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      max_tokens: 4096,
      temperature: 0,
      seed: DETERMINISM_SEED,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const text = response.choices[0]?.message?.content;
    if (typeof text === "string" && text.trim()) return text;
    throw new Error("Unexpected response type from OpenAI API");
  }
}

function extractJson(text: string): string {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return text.trim();
}

export async function callAIJson<T>(
  systemPrompt: string,
  userMessage: string
): Promise<T> {
  const enhancedSystem =
    systemPrompt +
    "\n\nRespond with valid JSON only. No markdown, no explanation, no code fences. All numeric values must be plain integers or decimals — never write numbers as words (e.g. use 50, not \"fifty\").";

  let text = await callAI(enhancedSystem, userMessage);

  try {
    return JSON.parse(extractJson(text)) as T;
  } catch (firstErr) {
    // Retry with the actual parse error so the AI knows what to fix
    const retryMessage =
      userMessage +
      `\n\nYour previous response was not valid JSON. Parse error: ${(firstErr as Error).message}. Previous response was: ${text.substring(0, 300)}. Return valid JSON only — no markdown, no code fences, all numbers must be digits not words.`;
    text = await callAI(enhancedSystem, retryMessage);
    return JSON.parse(extractJson(text)) as T;
  }
}
