import { spawn } from 'node:child_process'
import type { Context } from '@mini-dsh/cordis'
import { ShellExecutor, type ShellExecRequest, type ShellExecSpec, type ShellRunResult } from './service.ts'

export interface LocalShellConfig {
  timeoutMs?: number
  maxTimeoutMs?: number
  maxOutputBytes?: number
  workdir?: string
}

/** cmd.exe on Windows, bash elsewhere. The real repo ships pwsh/bash twins instead. */
function shellArgv(command: string): string[] {
  if (process.platform === 'win32') return ['cmd.exe', '/d', '/s', '/c', command]
  return ['bash', '-c', command]
}

export class LocalShellExecutor extends ShellExecutor {
  private readonly defaults: Required<LocalShellConfig>

  constructor(ctx: Context, config: LocalShellConfig = {}) {
    super(ctx)
    this.defaults = {
      timeoutMs: config.timeoutMs ?? 120_000,
      maxTimeoutMs: config.maxTimeoutMs ?? 600_000,
      maxOutputBytes: config.maxOutputBytes ?? 64_000,
      workdir: config.workdir ?? process.cwd(),
    }
  }

  resolve(request: ShellExecRequest): ShellExecSpec {
    const requested = request.timeoutMs ?? this.defaults.timeoutMs
    return {
      command: request.command,
      timeoutMs: Math.min(Math.max(1, requested), this.defaults.maxTimeoutMs),
      workdir: request.workdir ?? this.defaults.workdir,
      maxOutputBytes: this.defaults.maxOutputBytes,
    }
  }

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      const [executable, ...argv] = shellArgv(spec.command)
      const child = spawn(executable!, argv, {
        cwd: spec.workdir,
        env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat' },
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const clip = (current: string, chunk: Buffer): string =>
        current.length >= spec.maxOutputBytes ? current : (current + chunk.toString('utf8')).slice(0, spec.maxOutputBytes)
      child.stdout.on('data', (chunk: Buffer) => (stdout = clip(stdout, chunk)))
      child.stderr.on('data', (chunk: Buffer) => (stderr = clip(stderr, chunk)))
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, spec.timeoutMs)
      child.on('error', (error) => {
        clearTimeout(timer)
        rejectPromise(error)
      })
      child.on('close', (exitCode) => {
        clearTimeout(timer)
        resolvePromise({ exitCode, timedOut, stdout, stderr })
      })
    })
  }
}
