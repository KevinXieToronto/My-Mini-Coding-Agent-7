import { Service, type Context, type Disposable } from '@mini-dsh/cordis'
import type { ToolSchema } from '@mini-dsh/llm'

export interface PromptSection {
  /** Unique name; duplicates throw. */
  name: string
  /** Ascending sort key. Conventions from the real repo: -100 harness identity, 0 persona, 100+ tool guidance. */
  order: number
  text: string | (() => string)
}

export interface PromptAssembly {
  sections: { name: string; text: string }[]
  tools: ToolSchema[]
}

export const PERSONA_SECTION = 'deployment:persona'
export const PERSONA_ORDER = 0

declare module '@mini-dsh/cordis' {
  interface Context {
    systemPrompt: SystemPrompt
  }
  interface Events {
    /** Waterfall over the assembled prompt — the last chance to reshape it. Observers MUST call next(). */
    'system-prompt/assemble'(assembly: PromptAssembly, next: () => PromptAssembly): PromptAssembly
  }
}

export class SystemPrompt extends Service {
  private sections = new Map<string, PromptSection>()
  private toolProviders: (() => ToolSchema[])[] = []

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  /** Contribute one ordered prompt section. Reversible; duplicate names throw. */
  section(section: PromptSection): Disposable {
    return this.ctx.effect(() => {
      if (this.sections.has(section.name)) {
        throw new Error(`prompt section "${section.name}" is already registered`)
      }
      this.sections.set(section.name, section)
      return () => {
        this.sections.delete(section.name)
      }
    }, `systemPrompt.section(${JSON.stringify(section.name)})`)
  }

  /** Contribute tool schemas to every request (the tool registry plugs in here). */
  tools(provider: () => ToolSchema[]): Disposable {
    return this.ctx.effect(() => {
      this.toolProviders.push(provider)
      return () => {
        const index = this.toolProviders.indexOf(provider)
        if (index >= 0) this.toolProviders.splice(index, 1)
      }
    }, 'systemPrompt.tools')
  }

  /** Assemble fresh: sections sorted by order, tools collected, then the waterfall. */
  assemble(): PromptAssembly {
    const sections = [...this.sections.values()]
      .sort((a, b) => a.order - b.order)
      .map((section) => ({
        name: section.name,
        text: typeof section.text === 'function' ? section.text() : section.text,
      }))
    const tools = this.toolProviders.flatMap((provider) => provider())
    const assembly: PromptAssembly = { sections, tools }
    return this.ctx.waterfall('system-prompt/assemble', assembly, () => assembly)
  }
}

/** Pure rendering, separate from assembly — non-empty sections joined by blank lines. */
export function renderPrompt(assembly: PromptAssembly): string {
  return assembly.sections
    .map((section) => section.text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/** Plugin: set the deployment persona (order 0) from config. */
export const persona = {
  name: 'persona',
  inject: ['systemPrompt'] as const,
  apply(ctx: Context, config: { text: string }): void {
    ctx.systemPrompt.section({ name: PERSONA_SECTION, order: PERSONA_ORDER, text: config.text })
  },
}

/** Plugin: wire the tool registry's schemas into every assembled prompt. */
export const wireTools = {
  name: 'system-prompt-tools',
  inject: ['systemPrompt', 'tools'] as const,
  apply(ctx: Context): void {
    ctx.systemPrompt.tools(() => ctx.tools.schemas())
  },
}
