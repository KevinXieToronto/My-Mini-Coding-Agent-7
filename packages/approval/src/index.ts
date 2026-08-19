import { createInterface } from 'node:readline/promises'
import { Service, type Context } from '@mini-dsh/cordis'
import type { ToolExecution } from '@mini-dsh/tools'

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
export type ApprovalPolicy = 'ask' | 'never'

export interface ApprovalRequest {
  id: string
  toolName: string
  callId: string
  arguments: unknown
  reason?: string
}

declare module '@mini-dsh/cordis' {
  interface Context {
    approval: ApprovalService
  }
  interface Events {
    /**
     * Waterfall to whatever answerer is mounted (console, web, test script).
     * The innermost default returns 'unavailable' — absent answerers fail closed.
     */
    'approval/request'(request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
  }
}

// Extend the DURABLE event vocabulary from outside the core package —
// the merge-extensibility promised in Chapter 03, exactly how real dsh
// plugins add their own session events.
declare module '@mini-dsh/core' {
  interface SessionEventMap {
    'approval/asked': { id: string; toolName: string; callId: string; reason?: string }
    'approval/decided': { id: string; outcome: ApprovalOutcome }
  }
}

export interface ApprovalConfig {
  policy?: ApprovalPolicy
}

export class ApprovalService extends Service {
  policy: ApprovalPolicy
  private counter = 0

  constructor(ctx: Context, config: ApprovalConfig = {}) {
    super(ctx, 'approval')
    this.policy = config.policy ?? 'ask'
  }

  /**
   * Called by the tool runtime for every 'ask' decision (Chapter 05's
   * resolveAsk). Appends the audit pair around the answerer dispatch.
   */
  async request(exec: ToolExecution, reason?: string): Promise<ApprovalOutcome> {
    // 'never' short-circuits to rejected BEFORE any dispatch — same as the real repo.
    if (this.policy === 'never') return 'rejected'
    this.counter += 1
    const id = `approval-${this.counter}`
    exec.session?.append('approval/asked', {
      id,
      toolName: exec.name,
      callId: String(exec.callId),
      ...(reason !== undefined ? { reason } : {}),
    })
    let outcome: ApprovalOutcome
    try {
      outcome = await this.ctx.waterfall(
        'approval/request',
        {
          id,
          toolName: exec.name,
          callId: String(exec.callId),
          arguments: exec.arguments,
          ...(reason !== undefined ? { reason } : {}),
        },
        async (): Promise<ApprovalOutcome> => 'unavailable',
      )
    } catch {
      // A throwing answerer fails closed.
      outcome = 'unavailable'
    }
    exec.session?.append('approval/decided', { id, outcome })
    return outcome
  }
}

/** Policy plugin: the listed tools require approval. Pure composition — the runtime stays unaware. */
export const requireApproval = {
  name: 'require-approval',
  inject: ['tools'] as const,
  apply(ctx: Context, config: { tools: string[] }): void {
    ctx.on('tools/pre-execute', (exec, next) => {
      if (config.tools.includes(exec.name)) {
        return Promise.resolve({ kind: 'ask' as const, reason: `tool "${exec.name}" requires approval` })
      }
      return next()
    })
  },
}

/** Interactive answerer for terminals: y/N prompt on stderr. Non-TTY stdin delegates onward. */
export const consoleApprover = {
  name: 'console-approver',
  inject: ['approval'] as const,
  apply(ctx: Context): void {
    ctx.on('approval/request', async (request, next) => {
      if (!process.stdin.isTTY) return next()
      const rl = createInterface({ input: process.stdin, output: process.stderr })
      try {
        const answer = await rl.question(
          `[approval] allow tool "${request.toolName}" with ${JSON.stringify(request.arguments)}? (y/N) `,
        )
        return /^y(es)?$/i.test(answer.trim()) ? 'allowed-once' : 'rejected'
      } finally {
        rl.close()
      }
    })
  },
}
