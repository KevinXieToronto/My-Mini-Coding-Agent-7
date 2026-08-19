import { CallId } from '@mini-dsh/core'
import type { FinishReason, StreamChunk, TokenUsage } from '@mini-dsh/llm'

/** Decode a text/event-stream body into the `data:` payload strings. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data: ')) yield line.slice(6)
        newline = buffer.indexOf('\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

interface WireDelta {
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: {
    index: number
    id?: string
    function?: { name?: string; arguments?: string }
  }[]
}

interface WireChunk {
  choices?: { delta?: WireDelta; finish_reason?: string | null }[]
  usage?: { prompt_tokens: number; completion_tokens: number } | null
}

function mapFinishReason(reason: string): FinishReason {
  if (reason === 'stop') return { kind: 'stop' }
  if (reason === 'tool_calls') return { kind: 'tool-calls' }
  if (reason === 'length') return { kind: 'max-tokens' }
  return { kind: 'error', message: `unexpected finish_reason "${reason}"` }
}

/** DeepSeek SSE payloads → provider-independent StreamChunks. */
export async function* translate(events: AsyncIterable<string>): AsyncIterable<StreamChunk> {
  let finish: FinishReason | undefined
  let usage: TokenUsage | undefined
  let sawDone = false
  for await (const data of events) {
    if (data === '[DONE]') {
      sawDone = true
      break
    }
    const parsed = JSON.parse(data) as WireChunk
    if (parsed.usage !== undefined && parsed.usage !== null) {
      usage = { inputTokens: parsed.usage.prompt_tokens, outputTokens: parsed.usage.completion_tokens }
    }
    const choice = parsed.choices?.[0]
    if (choice === undefined) continue
    const delta = choice.delta
    if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
      yield { type: 'reasoning-delta', index: 0, text: delta.reasoning_content }
    }
    if (typeof delta?.content === 'string' && delta.content.length > 0) {
      yield { type: 'text-delta', index: 0, text: delta.content }
    }
    for (const toolCall of delta?.tool_calls ?? []) {
      yield {
        type: 'tool-call-delta',
        index: toolCall.index,
        ...(toolCall.id !== undefined ? { id: CallId(toolCall.id) } : {}),
        ...(toolCall.function?.name !== undefined ? { name: toolCall.function.name } : {}),
        argumentsDelta: toolCall.function?.arguments ?? '',
      }
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      finish = mapFinishReason(choice.finish_reason)
    }
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  if (!sawDone && finish === undefined) {
    yield { type: 'finish', reason: { kind: 'error', message: 'stream closed before [DONE]' } }
    return
  }
  yield { type: 'finish', reason: finish ?? { kind: 'error', message: 'stream ended without finish_reason' } }
}
