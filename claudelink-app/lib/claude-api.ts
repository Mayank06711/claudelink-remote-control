/**
 * Direct Claude API client — BYOK (Bring Your Own Key) mode.
 * Used when the user wants to interact with Claude directly from phone
 * without needing their PC to be running.
 *
 * This talks to Anthropic's Messages API with streaming (SSE).
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface StreamCallbacks {
  onText: (text: string) => void;
  onToolUse: (toolName: string, input: string) => void;
  onComplete: (fullResponse: string) => void;
  onError: (error: string) => void;
}

/**
 * Send a message to Claude API with streaming response.
 * Uses the user's own API key — we never store or transmit it to our servers.
 */
export async function streamMessage(
  apiKey: string,
  messages: Message[],
  callbacks: StreamCallbacks,
  model: string = DEFAULT_MODEL,
  systemPrompt?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: 8096,
    stream: true,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      callbacks.onError(`API error ${response.status}: ${errorText}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError("No response body");
      return;
    }

    const decoder = new TextDecoder();
    let fullResponse = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data);

            if (event.type === "content_block_delta") {
              if (event.delta?.type === "text_delta") {
                const text = event.delta.text;
                fullResponse += text;
                callbacks.onText(text);
              }
            } else if (event.type === "content_block_start") {
              if (event.content_block?.type === "tool_use") {
                callbacks.onToolUse(
                  event.content_block.name,
                  JSON.stringify(event.content_block.input || {})
                );
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    }

    callbacks.onComplete(fullResponse);
  } catch (err) {
    callbacks.onError(`Network error: ${err}`);
  }
}
