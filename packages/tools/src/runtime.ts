import { Service, type Context, type Disposable } from '@mini-dsh/cordis'
import type { CallId, ContentBlock, Session } from '@mini-dsh/core'
import type { ToolSchema } from '@mini-dsh/llm'
import { ToolArgsError, type ToolDefinition } from './schema.ts'

/** One tool call in flight. */
export interface ToolExecution {
  callId: CallId
  name: string
  arguments: unknown
  session?: Session
  signal?: AbortSignal
}

/** What the execute body receives alongside its validated args. */
export interface ToolRunContext {
  callId: CallId
  session?: Session
  signal?: AbortSignal
}

export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }

export type ToolExecutionResult =
  | { isError: false; value: unknown; content: ContentBlock[] }
  | { isError: true; error: { name: string; message: string }; content: ContentBlock[] }

/** Structural view of the approval service (provided in Chapter 09). */
interface ApprovalLike {
  request(exec: ToolExecution, reason?: string): Promise<'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'>
}

declare module '@mini-dsh/cordis' {
  interface Context {
    tools: ToolRuntime
  }
  interface Events {
    /**
     * Waterfall gate before every tool call. Guards return deny; approval
     * policies return ask; observers MUST call next(). Default: allow.
     */
    'tools/pre-execute'(exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
    'tools/result'(exec: ToolExecution, result: ToolExecutionResult): void
  }
}

function defaultRender(value: unknown): ContentBlock[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

export class ToolRuntime extends Service {
  private registry = new Map<string, ToolDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  /** Register a tool. Reversible; duplicate names throw. */
  register(definition: ToolDefinition): Disposable {
    return this.ctx.effect(() => {
      if (this.registry.has(definition.name)) {
        throw new Error(`tool "${definition.name}" is already registered`)
      }
      this.registry.set(definition.name, definition)
      return () => {
        this.registry.delete(definition.name)
      }
    }, `tools.register(${JSON.stringify(definition.name)})`)
  }

  get(name: string): ToolDefinition | undefined {
    return this.registry.get(name)
  }

  /** Exactly what reaches the model: name, description, parameters — nothing else. */
  schemas(): ToolSchema[] {
    return [...this.registry.values()].map(({ name, description, parameters }) => ({
      name,
      description,
      parameters: structuredClone(parameters),
    }))
  }

  /** The full pipeline: pre-execute gate -> (approval) -> execute -> render -> result event. */
  async execute(exec: ToolExecution): Promise<ToolExecutionResult> {
    const definition = this.registry.get(exec.name)
    let result: ToolExecutionResult
    if (definition === undefined) {
      result = this.failure('TOOL_NOT_FOUND', `no tool named "${exec.name}" is registered`)
    } else {
      const decision = await this.ctx.waterfall('tools/pre-execute', exec, async (): Promise<PreToolDecision> => ({ kind: 'allow' }))
      const resolved = decision.kind === 'ask' ? await this.resolveAsk(exec, decision.reason) : decision
      if (resolved.kind === 'deny') {
        result = this.failure('TOOL_DENIED', resolved.reason)
      } else {
        try {
          const value = await definition.execute(exec.arguments, {
            callId: exec.callId,
            ...(exec.session !== undefined ? { session: exec.session } : {}),
            ...(exec.signal !== undefined ? { signal: exec.signal } : {}),
          })
          result = { isError: false, value, content: (definition.render ?? defaultRender)(value) }
        } catch (error) {
          const name = error instanceof ToolArgsError ? error.code : error instanceof Error ? error.name : 'Error'
          result = this.failure(name, error instanceof Error ? error.message : String(error))
        }
      }
    }
    this.ctx.emit('tools/result', exec, result)
    return result
  }

  /**
   * 'ask' resolves through the approval service when one is mounted,
   * and FAILS CLOSED (deny) when none is — same policy as the real repo.
   */
  private async resolveAsk(exec: ToolExecution, reason?: string): Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string }> {
    const approval = this.ctx.get('approval') as ApprovalLike | undefined
    if (approval === undefined) {
      return { kind: 'deny', reason: 'approval required but no approval service is available' }
    }
    const outcome = await approval.request(exec, reason)
    if (outcome === 'allowed-once') return { kind: 'allow' }
    return { kind: 'deny', reason: `approval outcome: ${outcome}` }
  }

  private failure(name: string, message: string): ToolExecutionResult {
    return {
      isError: true,
      error: { name, message },
      content: [{ type: 'text', text: `Tool call failed (${name}): ${message}` }],
    }
  }
}
