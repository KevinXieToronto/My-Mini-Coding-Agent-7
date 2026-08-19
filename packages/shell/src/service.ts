import { Service, type Context } from '@mini-dsh/cordis'

export interface ShellExecRequest {
  command: string
  timeoutMs?: number
  workdir?: string
}

/** Fully defaulted/capped by resolve() — run() never re-defaults. */
export interface ShellExecSpec {
  command: string
  timeoutMs: number
  workdir: string
  maxOutputBytes: number
}

export interface ShellRunResult {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
}

declare module '@mini-dsh/cordis' {
  interface Context {
    shell: ShellExecutor
  }
}

/**
 * The shell SERVICE DEFINITION. Contract: run() rejects only for
 * infrastructure failures — nonzero exits and timeouts RESOLVE with a result.
 */
export abstract class ShellExecutor extends Service {
  constructor(ctx: Context) {
    super(ctx, 'shell')
  }

  abstract resolve(request: ShellExecRequest): ShellExecSpec
  abstract run(spec: ShellExecSpec): Promise<ShellRunResult>
}
