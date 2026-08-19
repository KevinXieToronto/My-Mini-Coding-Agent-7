import type { ContentBlock, Message } from '@mini-dsh/core'
import type { GenerateOptions } from '@mini-dsh/llm'

function flattenText(content: ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/**
 * Canonical messages → DeepSeek (OpenAI-compatible) wire format.
 * Two hard-won rules from the real adapter:
 *   - assistant `content` is "" — never null;
 *   - tool results become standalone { role: "tool" } messages keyed by tool_call_id.
 */
function serializeMessage(message: Message): Record<string, unknown>[] {
  if (message.role === 'assistant') {
    const toolCalls = message.content
      .filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
      .map((block) => ({
        id: block.id,
        type: 'function' as const,
        // `arguments` stays the raw JSON string the model produced.
        function: { name: block.name, arguments: block.arguments },
      }))
    return [
      {
        role: 'assistant',
        content: flattenText(message.content),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    ]
  }
  const results = message.content.filter(
    (block): block is Extract<ContentBlock, { type: 'tool-result' }> => block.type === 'tool-result',
  )
  if (results.length > 0) {
    return results.map((block) => ({
      role: 'tool',
      tool_call_id: block.toolCallId,
      content: flattenText(block.content) || '(no output)',
    }))
  }
  return [{ role: message.role, content: flattenText(message.content) }]
}

export function serializeRequest(options: GenerateOptions): Record<string, unknown> {
  const messages: Record<string, unknown>[] = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  for (const message of options.messages) messages.push(...serializeMessage(message))
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(options.tools !== undefined && options.tools.length > 0
      ? {
          tools: options.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
        }
      : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
  }
}
