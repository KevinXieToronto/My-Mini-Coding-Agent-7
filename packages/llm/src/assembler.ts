import type { ContentBlock } from '@mini-dsh/core'
import { CallId } from '@mini-dsh/core'
import type { FinishReason, StreamChunk, TokenUsage } from './types.ts'

interface OpenText {
  kind: 'text' | 'reasoning'
  text: string
}

interface OpenToolCall {
  kind: 'tool-call'
  id: string
  name: string
  argumentsJson: string
}

/**
 * The single canonical chunk→blocks algorithm (mirrors the real repo's
 * BlockAssembler): fold deltas by (type, index), then emit blocks in order
 * reasoning → text → tool calls. Tool calls are dropped on a max-tokens
 * finish — a truncated call can never be executed safely.
 */
export class BlockAssembler {
  private reasoning = new Map<number, OpenText>()
  private text = new Map<number, OpenText>()
  private toolCalls = new Map<number, OpenToolCall>()
  usage: TokenUsage | undefined
  finish: FinishReason | undefined

  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'text-delta': {
        const open = this.text.get(chunk.index) ?? { kind: 'text' as const, text: '' }
        open.text += chunk.text
        this.text.set(chunk.index, open)
        break
      }
      case 'reasoning-delta': {
        const open = this.reasoning.get(chunk.index) ?? { kind: 'reasoning' as const, text: '' }
        open.text += chunk.text
        this.reasoning.set(chunk.index, open)
        break
      }
      case 'tool-call-delta': {
        const open = this.toolCalls.get(chunk.index) ?? { kind: 'tool-call' as const, id: '', name: '', argumentsJson: '' }
        if (chunk.id !== undefined) open.id = chunk.id
        if (chunk.name !== undefined) open.name = chunk.name
        open.argumentsJson += chunk.argumentsDelta
        this.toolCalls.set(chunk.index, open)
        break
      }
      case 'usage':
        this.usage = chunk.usage
        break
      case 'finish':
        this.finish = chunk.reason
        break
    }
  }

  blocks(): ContentBlock[] {
    const result: ContentBlock[] = []
    for (const [, open] of [...this.reasoning.entries()].sort((a, b) => a[0] - b[0])) {
      if (open.text.length > 0) result.push({ type: 'reasoning', text: open.text })
    }
    for (const [, open] of [...this.text.entries()].sort((a, b) => a[0] - b[0])) {
      if (open.text.length > 0) result.push({ type: 'text', text: open.text })
    }
    if (this.finish?.kind !== 'max-tokens') {
      for (const [, open] of [...this.toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
        result.push({ type: 'tool-call', id: CallId(open.id), name: open.name, arguments: open.argumentsJson })
      }
    }
    return result
  }
}
