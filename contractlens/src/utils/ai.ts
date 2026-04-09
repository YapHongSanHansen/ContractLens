import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function callAI(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const block = response.content[0];
  if (block.type === "text") {
    return block.text;
  }
  throw new Error("Unexpected response type from Anthropic API");
}

export async function callAIJson<T>(
  systemPrompt: string,
  userMessage: string
): Promise<T> {
  const enhancedSystem =
    systemPrompt +
    "\n\nRespond with valid JSON only. No markdown, no explanation, no code fences.";

  let text = await callAI(enhancedSystem, userMessage);

  try {
    return JSON.parse(text) as T;
  } catch {
    // Retry once with error context
    const retryMessage =
      userMessage +
      `\n\nYour previous response was not valid JSON. The parse error was: ${text.substring(0, 200)}... Please return valid JSON only, no markdown.`;
    text = await callAI(enhancedSystem, retryMessage);
    return JSON.parse(text) as T;
  }
}
