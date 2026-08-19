import { rm } from 'node:fs/promises'
import { Context } from '@mini-dsh/cordis'
import { CallId } from '@mini-dsh/core'
import { LocalFileSystem, toolFs } from '@mini-dsh/fs'
import { LocalShellExecutor, toolShell } from '@mini-dsh/shell'
import { ToolRuntime } from '@mini-dsh/tools'

await rm('tmp-ch05', { recursive: true, force: true })

const root = new Context()
root.plugin(ToolRuntime)
root.plugin(LocalFileSystem)
root.plugin(LocalShellExecutor)
root.plugin(toolFs)
root.plugin(toolShell)

// A guard on the pre-execute waterfall: deny destructive shell commands.
root.plugin({
  name: 'shell-guard',
  inject: ['tools'],
  apply: (ctx) => {
    ctx.on('tools/pre-execute', (exec, next) => {
      if (exec.name === 'shell') {
        const args = exec.arguments as { command?: string }
        if (typeof args.command === 'string' && /\b(rmdir|del|format)\b/i.test(args.command)) {
          return Promise.resolve({ kind: 'deny' as const, reason: 'destructive commands are blocked by shell-guard' })
        }
      }
      return next()
    })
  },
})

console.log('tool schemas:', root.tools.schemas().map((schema) => schema.name).join(', '))

let calls = 0
async function call(name: string, args: Record<string, unknown>): Promise<void> {
  calls += 1
  const result = await root.tools.execute({ callId: CallId(`call-${calls}`), name, arguments: args })
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  console.log(`${name} -> ${result.isError ? 'ERROR' : 'ok'}: ${text.split('\n')[0]}`)
}

await call('write', { file_path: 'tmp-ch05/notes.txt', content: 'alpha\nbeta\ngamma' })
await call('read', { file_path: 'tmp-ch05/notes.txt' })
await call('edit', { file_path: 'tmp-ch05/notes.txt', old_string: 'beta', new_string: 'BETA' })
await call('read', { file_path: 'tmp-ch05/notes.txt', offset: 2, limit: 1 })
await call('shell', { command: 'echo hello from the shell tool', description: 'Print a greeting' })
await call('shell', { command: 'del tmp-ch05', description: 'Try something destructive' })
await call('read', { file_path: 'tmp-ch05/missing.txt' })
await call('edit', { file_path: 'tmp-ch05/notes.txt', old_string: 'a', new_string: 'x' })
