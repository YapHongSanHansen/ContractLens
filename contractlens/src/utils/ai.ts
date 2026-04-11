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

// Map of English number words to digit equivalents. Covers the cases we've
// actually seen the model produce (riskScore: sixty, confidence: ninety). We
// keep this minimal — if the model ever writes "three hundred" for a risk
// score we want the retry path to catch it, not a fragile multi-word parser.
const WORD_TO_NUMBER: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
  thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70",
  eighty: "80", ninety: "90", hundred: "100",
};

// Replace bare word-numbers that appear where JSON expects a number (after
// `:` or `,` or `[`, NOT inside a string). Walks the text tracking string
// state so values like `"summary": "about fifty percent"` are left alone.
function sanitizeWordNumbers(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i++;
      continue;
    }
    // Try to match a word-number token at this position. Only substitute
    // when the preceding non-whitespace char is `:`, `,` or `[` — i.e. a
    // position where JSON expects a value.
    const wordMatch = text.slice(i).match(/^([a-zA-Z]+)/);
    if (wordMatch) {
      const word = wordMatch[1].toLowerCase();
      const digit = WORD_TO_NUMBER[word];
      if (digit !== undefined) {
        const prev = out.replace(/\s+$/, "").slice(-1);
        if (prev === ":" || prev === "," || prev === "[") {
          out += digit;
          i += wordMatch[1].length;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

// Strip trailing commas before `}` or `]` — another common LLM mistake.
function stripTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

function tryParseJson<T>(text: string): T | null {
  const candidates = [
    text,
    sanitizeWordNumbers(text),
    stripTrailingCommas(sanitizeWordNumbers(text)),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next
    }
  }
  return null;
}

export async function callAIJson<T>(
  systemPrompt: string,
  userMessage: string
): Promise<T> {
  const enhancedSystem =
    systemPrompt +
    "\n\nRespond with valid JSON only. No markdown, no explanation, no code fences. All numeric values must be plain integers or decimals — never write numbers as words (e.g. use 50, not \"fifty\").";

  let text = await callAI(enhancedSystem, userMessage);
  let parsed = tryParseJson<T>(extractJson(text));
  if (parsed !== null) return parsed;

  // Retry with the actual parse error so the AI knows what to fix
  const retryMessage =
    userMessage +
    `\n\nYour previous response was not valid JSON. Return valid JSON only — no markdown, no code fences, all numbers must be digits not words (write 60 not "sixty"). Previous response started with: ${text.substring(0, 300)}`;
  text = await callAI(enhancedSystem, retryMessage);
  parsed = tryParseJson<T>(extractJson(text));
  if (parsed !== null) return parsed;

  throw new Error(
    `callAIJson: could not parse model output after retry. First 300 chars: ${text.substring(0, 300)}`
  );
}
