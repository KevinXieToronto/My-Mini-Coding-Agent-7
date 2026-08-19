import { Context } from '@mini-dsh/cordis'
import { ApprovalService, requireApproval, type ApprovalOutcome } from '@mini-dsh/approval'
import { CallId, SessionStore } from '@mini-dsh/core'
import { LocalShellExecutor, toolShell } from '@mini-dsh/shell'
import { ToolRuntime } from '@mini-dsh/tools'

const root = new Context()
root.plugin(SessionStore)
root.plugin(ToolRuntime)
root.plugin(LocalShellExecutor)
root.plugin(toolShell)
root.plugin(ApprovalService, { policy: 'ask' })
root.plugin(requireApproval, { tools: ['shell'] })

// A scripted answerer: first request allowed, second rejected.
const scripted: ApprovalOutcome[] = ['allowed-once', 'rejected']
root.plugin({
  name: 'scripted-approver',
  inject: ['approval'],
  apply: (ctx) => {
    ctx.on('approval/request', (request, next) => {
      const outcome = scripted.shift()
      console.log(`  [answerer] ${request.id} for "${request.toolName}" -> ${outcome ?? '(script empty, delegating)'}`)
      return outcome !== undefined ? Promise.resolve(outcome) : next()
    })
  },
})

const session = root.sessions.create()
let calls = 0
async function runShell(command: string): Promise<void> {
  calls += 1
  const result = await root.tools.execute({
    callId: CallId(`call-${calls}`),
    name: 'shell',
    arguments: { command, description: 'Demo command' },
    session,
  })
  const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
  console.log(`shell #${calls} -> ${result.isError ? 'DENIED' : 'ok'}: ${text.split('\n')[0]}`)
}

await runShell('echo approved run')
await runShell('echo this one gets rejected')

// Flip the policy: 'never' short-circuits before any dispatch — no audit pair, no answerer.
root.approval.policy = 'never'
await runShell('echo never even asked')

console.log('audit trail in the session log:')
for (const event of session.events) {
  if (event.type === 'approval/asked') console.log(`  seq=${event.seq} approval/asked   ${event.data.id} tool=${event.data.toolName}`)
  if (event.type === 'approval/decided') console.log(`  seq=${event.seq} approval/decided ${event.data.id} -> ${event.data.outcome}`)
}
