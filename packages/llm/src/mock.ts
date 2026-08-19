import { CallId } from '@mini-dsh/core'
import { LlmAdapter } from './runtime.ts'
import type { GenerateOptions, StreamChunk } from './types.ts'

export type MockPart =
  | { text: string }
  | { toolCall: { id?: string; name: string; arguments: string } }

/** One scripted model response = the parts of one assistant message. */
export type MockTurn = MockPart[]

/**
 * A scriptable adapter for keyless testing: each call to stream() consumes
 * the next scripted turn and replays it as chunks (text split in two deltas
 * to prove downstream code really handles streaming). The real repo does the
 * same job with recorded JSONL snapshot replays.
 */
export class MockAdapter extends LlmAdapter {
  private cursor = 0

  constructor(private readonly script: MockTurn[]) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const turn = this.script[this.cursor]
    this.cursor += 1
    if (turn === undefined) {
      yield { type: 'finish', reason: { kind: 'error', message: 'mock script exhausted' } }
      return
    }
    let textIndex = 0
    let toolIndex = 0
    let sawToolCall = false
    for (const part of turn) {
      if ('text' in part) {
        const mid = Math.ceil(part.text.length / 2)
        yield { type: 'text-delta', index: textIndex, text: part.text.slice(0, mid) }
        yield { type: 'text-delta', index: textIndex, text: part.text.slice(mid) }
        textIndex += 1
      } else {
        sawToolCall = true
        yield {
          type: 'tool-call-delta',
          index: toolIndex,
          id: CallId(part.toolCall.id ?? `call-${this.cursor}-${toolIndex}`),
          name: part.toolCall.name,
          argumentsDelta: part.toolCall.arguments,
        }
        toolIndex += 1
      }
    }
    yield { type: 'usage', usage: { inputTokens: options.messages.length * 10, outputTokens: 7 } }
    yield { type: 'finish', reason: sawToolCall ? { kind: 'tool-calls' } : { kind: 'stop' } }
  }
}
