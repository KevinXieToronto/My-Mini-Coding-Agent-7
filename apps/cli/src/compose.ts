import type { Context } from '@mini-dsh/cordis'
import { AgentRegistry } from '@mini-dsh/agent'
import { SessionStore, type Message } from '@mini-dsh/core'
import { LocalFileSystem, toolFs } from '@mini-dsh/fs'
import { LlmAdapter, LlmRuntime, type GenerateOptions, type StreamChunk } from '@mini-dsh/llm'
import * as llmDeepSeek from '@mini-dsh/llm-deepseek'
import { SqliteSessionPersistence } from '@mini-dsh/persistence-sqlite'
import { LocalShellExecutor, toolShell } from '@mini-dsh/shell'
import { persona, SystemPrompt, wireTools } from '@mini-dsh/system-prompt'
import { ToolRuntime } from '@mini-dsh/tools'

/**
 * A deterministic keyless provider: echoes the latest user text back.
 * (The scripted MockAdapter from Chapter 04 is for tests with a known plot;
 * this one keeps interactive surfaces usable without an API key.)
 */
export class MockEchoAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const lastUser = [...options.messages].reverse().find(
      (message: Message) => message.role === 'user' && message.content.some((block) => block.type === 'text'),
    )
    const text = lastUser?.content
      .filter((block): block is Extract<Message['content'][number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('') ?? '(no user text)'
    yield { type: 'text-delta', index: 0, text: `ECHO: ${text}` }
    yield { type: 'usage', usage: { inputTokens: options.messages.length, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export interface ComposeOptions {
  providerKind: 'deepseek' | 'mock'
  personaText?: string
  /** When set, sessions persist to this SQLite file. */
  dbPath?: string
}

/**
 * The whole harness as one composition — the CLI's equivalent of the real
 * repo's dsh-base bundle layer. Order does not matter: plugins with inject
 * stay pending until their services exist.
 */
export function composeHarness(root: Context, options: ComposeOptions): void {
  root.plugin(SessionStore)
  root.plugin(LlmRuntime)
  root.plugin(ToolRuntime)
  root.plugin(SystemPrompt)
  root.plugin(LocalFileSystem)
  root.plugin(LocalShellExecutor)
  root.plugin(toolFs)
  root.plugin(toolShell)
  root.plugin(persona, {
    text: options.personaText ?? 'You are mini-dsh, a helpful coding agent. Use the available tools to complete the task, then summarize what you did.',
  })
  root.plugin(wireTools)
  root.plugin(AgentRegistry)
  if (options.dbPath !== undefined) {
    root.plugin(SqliteSessionPersistence, { path: options.dbPath })
  }
  if (options.providerKind === 'mock') {
    root.plugin({
      name: 'llm-mock-echo',
      inject: ['llm'],
      apply: (ctx) => {
        ctx.llm.registerAdapter(['mock'], new MockEchoAdapter())
      },
    })
  } else {
    root.plugin(llmDeepSeek)
  }

  const pending = root.pendingNames()
  if (pending.length > 0) {
    throw new Error(`composition incomplete, plugins still pending: ${pending.join('; ')}`)
  }
}
