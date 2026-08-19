import { randomUUID } from 'node:crypto'
import type { Branded } from './brand.ts'

export type MessageId = Branded<'MessageId'>
export function MessageId(id: string): MessageId {
  return id as MessageId
}

/** Identifies one tool call within one assistant message (minted by the model provider). */
export type CallId = Branded<'CallId'>
export function CallId(id: string): CallId {
  return id as CallId
}

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ReasoningBlock {
  type: 'reasoning'
  text: string
}

export interface ToolCallBlock {
  type: 'tool-call'
  id: CallId
  name: string
  /** Raw JSON string exactly as the model produced it — parsed only at execution time. */
  arguments: string
}

export interface ToolResultBlock {
  type: 'tool-result'
  toolCallId: CallId
  content: ContentBlock[]
  isError?: boolean
}

export type ContentBlock = TextBlock | ReasoningBlock | ToolCallBlock | ToolResultBlock

export type MessageSource =
  | { kind: 'user' }
  | { kind: 'model'; provider: string; model: string }
  | { kind: 'tool'; toolName: string }
  | { kind: 'plugin'; plugin: string }

export interface Message {
  readonly id: MessageId
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: ContentBlock[]
  readonly source: MessageSource
}

export interface UserMessage extends Message {
  readonly role: 'user'
}

export interface AssistantMessage extends Message {
  readonly role: 'assistant'
  readonly source: { kind: 'model'; provider: string; model: string }
}

/**
 * Tool results are USER-role messages holding a single tool-result block —
 * same as the real repo. The provider adapter turns them back into wire-level
 * `role: "tool"` entries.
 */
export interface ToolResultMessage extends Message {
  readonly role: 'user'
  readonly content: [ToolResultBlock]
  readonly source: { kind: 'tool'; toolName: string }
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** Every constructor detaches (structuredClone) and freezes — messages are immutable values. */
function freezeMessage<T extends Message>(message: T): T {
  return deepFreeze(structuredClone(message))
}

export function createUserMessage(options: { content: ContentBlock[]; source?: MessageSource }): UserMessage {
  return freezeMessage({
    id: MessageId(`msg-${randomUUID()}`),
    role: 'user',
    content: options.content,
    source: options.source ?? { kind: 'user' },
  })
}

export function createAssistantMessage(options: {
  content: ContentBlock[]
  source: { kind: 'model'; provider: string; model: string }
}): AssistantMessage {
  return freezeMessage({
    id: MessageId(`msg-${randomUUID()}`),
    role: 'assistant',
    content: options.content,
    source: options.source,
  })
}

export function createToolResultMessage(options: {
  callId: CallId
  toolName: string
  content: ContentBlock[]
  isError?: boolean
}): ToolResultMessage {
  return freezeMessage({
    id: MessageId(`msg-${randomUUID()}`),
    role: 'user',
    content: [
      {
        type: 'tool-result',
        toolCallId: options.callId,
        content: options.content,
        ...(options.isError === true ? { isError: true } : {}),
      },
    ],
    source: { kind: 'tool', toolName: options.toolName },
  })
}
