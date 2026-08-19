import { Context } from '@mini-dsh/cordis'
import { createUserMessage } from '@mini-dsh/core'
import { composeHarness } from './compose.ts'
import { summarize } from './summarize.ts'

interface CliInvocation {
  task: string
  providerKind: 'deepseek' | 'mock'
  provider: string
  model: string
}

function parseArgs(argv: string[]): CliInvocation {
  let mock = false
  let provider: string | undefined
  let model: string | undefined
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--mock') mock = true
    else if (arg === '--provider') provider = argv[++i]
    else if (arg === '--model') model = argv[++i]
    else positionals.push(arg)
  }
  const task = positionals.join(' ').trim()
  if (task === '') {
    console.error('usage: pnpm dsh [--mock] [--provider <name>] [--model <name>] "<task>"')
    process.exit(2)
  }
  const providerKind = mock ? 'mock' : 'deepseek'
  return {
    task,
    providerKind,
    provider: provider ?? (mock ? 'mock' : 'deepseek'),
    model: model ?? (mock ? 'mock-1' : 'deepseek-chat'),
  }
}

const invocation = parseArgs(process.argv.slice(2))

const root = new Context()
composeHarness(root, { providerKind: invocation.providerKind })

// Progress goes to stderr; only the outcome goes to stdout.
root.on('session/event', (_session, event) => {
  if (event.type === 'tool/call') console.error(`  [tool] ${event.data.name} ${event.data.arguments}`)
  if (event.type === 'tool/result') console.error(`  [tool] -> ${event.data.error === undefined ? 'ok' : `error (${event.data.error.name})`}`)
})
root.on('agent/error', (_agent, error) => {
  console.error('  [agent error]', error instanceof Error ? error.message : error)
})

const agent = root.agents.create({
  agentOptions: { provider: invocation.provider, model: invocation.model },
})
agent.followup(createUserMessage({ content: [{ type: 'text', text: invocation.task }] }))
await agent.whenIdle()

const outcome = summarize(agent.session.events)
console.log(outcome.text)
process.exit(outcome.reasonKind === 'completed' ? 0 : 1)
