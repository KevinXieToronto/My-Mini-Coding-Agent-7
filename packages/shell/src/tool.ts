import type { Context } from '@mini-dsh/cordis'
import { defineTool } from '@mini-dsh/tools'
import type { ShellRunResult } from './service.ts'

export const name = 'tool-shell'
export const inject = ['tools', 'shell'] as const

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'shell',
    description:
      'Execute a shell command and return its output. Each call runs a fresh shell: ' +
      'pass workdir instead of using cd. Output ends with an [exit code: N] marker.',
    parameters: {
      command: { type: 'string', required: true, description: 'The shell command to execute.' },
      description: { type: 'string', required: true, description: 'Clear, concise description of what this command does, in 5-10 words (shown in the UI).' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.' },
      workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace.' },
    },
    execute: async (args) => {
      const spec = ctx.shell.resolve({
        command: args.command,
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.workdir !== undefined ? { workdir: args.workdir } : {}),
      })
      return await ctx.shell.run(spec)
    },
    render: (value) => {
      const result = value as ShellRunResult
      const parts = [result.stdout, result.stderr].filter((part) => part.length > 0)
      if (result.timedOut) parts.push('[command timed out]')
      parts.push(`[exit code: ${result.exitCode ?? 'none'}]`)
      return [{ type: 'text', text: parts.join('\n') }]
    },
  }))
}
