import { Service, type Context, type Disposable } from '@mini-dsh/cordis'
import type { GenerateOptions, StreamChunk } from './types.ts'

declare module '@mini-dsh/cordis' {
  interface Context {
    llm: LlmRuntime
  }
  interface Events {
    /**
     * Waterfall around every model request. Middleware may inspect or wrap
     * the chunk stream — an observing listener MUST call next().
     */
    'llm/stream'(options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
  }
}

/** A model provider. The only required method — streaming is the only call path. */
export abstract class LlmAdapter {
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

export class LlmRuntime extends Service {
  private adapters = new Map<string, LlmAdapter>()

  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  /** Route one or more provider names to an adapter. Reversible; duplicates throw. */
  registerAdapter(providers: string[], adapter: LlmAdapter): Disposable {
    return this.ctx.effect(() => {
      for (const provider of providers) {
        if (this.adapters.has(provider)) {
          throw new Error(`llm provider "${provider}" is already registered`)
        }
      }
      for (const provider of providers) this.adapters.set(provider, adapter)
      return () => {
        for (const provider of providers) this.adapters.delete(provider)
      }
    }, 'llm.registerAdapter')
  }

  listProviders(): string[] {
    return [...this.adapters.keys()]
  }

  /**
   * The single entry point consumers use. Routes to the adapter through the
   * 'llm/stream' waterfall and normalizes adapter throws into a terminal
   * finish chunk — callers never try/catch the iteration.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.ctx.waterfall('llm/stream', options, () => {
      const adapter = this.adapters.get(options.provider)
      if (adapter === undefined) {
        throw new Error(`no llm adapter registered for provider "${options.provider}"`)
      }
      return this.contained(adapter.stream(options), options.signal)
    })
  }

  private async *contained(inner: AsyncIterable<StreamChunk>, signal?: AbortSignal): AsyncIterable<StreamChunk> {
    try {
      yield* inner
    } catch (error) {
      yield {
        type: 'finish',
        reason: signal?.aborted === true
          ? { kind: 'aborted' }
          : { kind: 'error', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }
}
