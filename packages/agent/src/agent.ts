import type { Context } from '@mini-dsh/cordis'
import {
  createAssistantMessage,
  createToolResultMessage,
  type Session,
  type ToolCallBlock,
  type TurnEndReason,
  type UserMessage,
} from '@mini-dsh/core'
import { BlockAssembler, type GenerateOptions } from '@mini-dsh/llm'
import { renderPrompt } from '@mini-dsh/system-prompt'
import { Inbox } from './inbox.ts'

export interface AgentOptions {
  provider: string
  model: string
  temperature?: number
  maxTokens?: number
}

export type LlmCallConfig = AgentOptions

export type AgentStatus = 'idle' | 'running'

declare module '@mini-dsh/cordis' {
  interface Events {
    'agent/created'(agent: Agent): void
    'agent/status'(agent: Agent, status: AgentStatus): void
    /** Waterfall over the per-request call config — plugins may adjust model, temperature, … */
    'agent/request'(agent: Agent, config: LlmCallConfig, next: () => LlmCallConfig): LlmCallConfig
    'agent/error'(agent: Agent, error: unknown): void
  }
}

/** Invalid JSON is preserved as raw text so the model sees its own mistake. */
function parseArguments(raw: string): unknown {
  try {
    return raw === '' ? {} : JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * The react-loop driver. A turn is zero or more steps; a step is one model
 * request plus its tool calls. Termination: a step whose assistant message
 * contains no tool calls completes the turn.
 */
export class Agent {
  readonly inbox = new Inbox()
  status: AgentStatus = 'idle'
  private turnCounter = 0
  private running: Promise<void> | null = null

  constructor(
    private readonly loopCtx: Context,
    readonly session: Session,
    readonly options: AgentOptions,
  ) {}

  get id(): Session['id'] {
    return this.session.id
  }

  /** Queue a message for the next turn and wake the driver. */
  followup(message: UserMessage): void {
    this.inbox.push('next-turn', message)
    this.wake()
  }

  /** Queue a steering message: claimed between steps of the running turn. */
  steer(message: UserMessage): void {
    this.inbox.push('next-step', message)
    this.wake()
  }

  async whenIdle(): Promise<void> {
    while (this.running !== null) await this.running
  }

  private wake(): void {
    if (this.running !== null) return
    this.setStatus('running')
    this.running = this.drive()
      .catch((error) => this.loopCtx.emit('agent/error', this, error))
      .finally(() => {
        this.running = null
        this.setStatus('idle')
      })
  }

  private setStatus(status: AgentStatus): void {
    this.status = status
    this.loopCtx.emit('agent/status', this, status)
  }

  private async drive(): Promise<void> {
    while (this.inbox.hasPending) {
      await this.turn()
    }
  }

  private async turn(): Promise<void> {
    const turn = this.turnCounter
    this.turnCounter += 1
    this.session.append('turn/start', { turn })
    let reason: TurnEndReason = { kind: 'completed' }
    try {
      let step = 0
      let target: 'next-turn' | 'next-step' = 'next-turn'
      while (true) {
        const claimed = this.inbox.claim(target)
        this.session.append('step/start', { turn, step })
        for (const message of claimed) this.session.append('user/message', message)
        const outcome = await this.step(turn, step)
        this.session.append('step/end', { turn, step })
        if (outcome !== null) {
          reason = outcome
          break
        }
        step += 1
        target = 'next-step'
      }
    } catch (error) {
      reason = { kind: 'error', message: error instanceof Error ? error.message : String(error) }
      this.loopCtx.emit('agent/error', this, error)
    }
    this.session.append('turn/end', { turn, reason })
  }

  /** One step: assemble → request (from the log!) → stream → maybe tool round-trip. */
  private async step(turn: number, step: number): Promise<TurnEndReason | null> {
    const assembly = this.loopCtx.systemPrompt.assemble()
    const baseConfig: LlmCallConfig = { ...this.options }
    const config = this.loopCtx.waterfall('agent/request', this, baseConfig, () => baseConfig)

    const request: GenerateOptions = {
      provider: config.provider,
      model: config.model,
      // Model-visible means logged: the conversation IS the folded session log.
      messages: this.session.deriveMessages(),
      system: renderPrompt(assembly),
      tools: assembly.tools,
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    }

    const assembler = new BlockAssembler()
    for await (const chunk of this.loopCtx.llm.stream(request)) assembler.push(chunk)

    const finish = assembler.finish ?? { kind: 'error' as const, message: 'stream produced no finish chunk' }
    if (finish.kind === 'error') return { kind: 'error', message: finish.message }
    if (finish.kind === 'aborted') return { kind: 'aborted' }

    const message = createAssistantMessage({
      content: assembler.blocks(),
      source: { kind: 'model', provider: config.provider, model: config.model },
    })
    this.session.append('assistant/message', { turn, step, message })

    const toolCalls = message.content.filter((block): block is ToolCallBlock => block.type === 'tool-call')
    if (toolCalls.length === 0) {
      return finish.kind === 'max-tokens' ? { kind: 'max-tokens' } : { kind: 'completed' }
    }
    await this.executeToolCalls(turn, step, toolCalls)
    return null // the model still owes a response — run another step
  }

  /** Tool calls execute and commit in model order; results go back as events. */
  private async executeToolCalls(turn: number, step: number, toolCalls: ToolCallBlock[]): Promise<void> {
    for (const block of toolCalls) {
      this.session.append('tool/call', {
        turn,
        step,
        callId: block.id,
        name: block.name,
        arguments: block.arguments,
      })
      const result = await this.loopCtx.tools.execute({
        callId: block.id,
        name: block.name,
        arguments: parseArguments(block.arguments),
        session: this.session,
      })
      const message = createToolResultMessage({
        callId: block.id,
        toolName: block.name,
        content: result.content,
        isError: result.isError,
      })
      this.session.append('tool/result', {
        turn,
        step,
        message,
        ...(result.isError ? { error: result.error } : {}),
      })
    }
  }
}
