import type { Message } from '@mini-dsh/core'
import type { CallId } from '@mini-dsh/core'

/** Exactly what a tool looks like to the model: name, description, JSON Schema. */
export interface ToolSchema {
  name: string
  description: string
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>
}

export interface GenerateOptions {
  provider: string
  model: string
  messages: Message[]
  system?: string
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export type FinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-calls' }
  | { kind: 'max-tokens' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string }

/**
 * The provider-independent streaming vocabulary. Deltas are grouped by
 * (type, index); the BlockAssembler folds them back into ContentBlocks.
 */
export type StreamChunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id?: CallId; name?: string; argumentsDelta: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason }
