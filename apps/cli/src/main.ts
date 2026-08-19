import { Context } from '@mini-dsh/cordis'
import { createUserMessage, SessionId } from '@mini-dsh/core'
import * as webUi from '@mini-dsh/web-ui'
import { composeHarness } from './compose.ts'
import { summarize } from './summarize.ts'

interface CliInvocation {
  web: boolean
  task: string
  providerKind: 'deepseek' | 'mock'
  provider: string
  model: string
  dbPath: string
  port: number
  list: boolean
  resume: string | undefined
  askTools: string[]
}

function parseArgs(argv: string[]): CliInvocation {
  let web = false
  let mock = false
  let list = false
  let provider: string | undefined
  let model: string | undefined
  let resume: string | undefined
  let dbPath = '.mini-dsh/sessions.db'
  let port = 3080
  let askTools: string[] = []
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === 'web' && positionals.length === 0 && !web) web = true
    else if (arg === '--mock') mock = true
    else if (arg === '--list') list = true
    else if (arg === '--resume') resume = argv[++i]
    else if (arg === '--db') dbPath = argv[++i] ?? dbPath
    else if (arg === '--port') port = Number(argv[++i] ?? port)
    else if (arg === '--provider') provider = argv[++i]
    else if (arg === '--model') model = argv[++i]
    else if (arg === '--ask-tools') askTools = (argv[++i] ?? '').split(',').filter((name) => name !== '')
    else positionals.push(arg)
  }
  const task = positionals.join(' ').trim()
  if (!web && !list && task === '') {
    console.error('usage: pnpm dsh [web] [--mock] [--list] [--resume <session-id>] [--db <path>] [--port <n>] [--ask-tools <a,b>] [--provider <name>] [--model <name>] "<task>"')
    process.exit(2)
  }
  const providerKind = mock ? 'mock' : 'deepseek'
  return {
    web,
    task,
    providerKind,
    provider: provider ?? (mock ? 'mock' : 'deepseek'),
    model: model ?? (mock ? 'mock-1' : 'deepseek-chat'),
    dbPath,
    port,
    list,
    resume,
    askTools,
  }
}

const invocation = parseArgs(process.argv.slice(2))

const root = new Context()
composeHarness(root, {
  providerKind: invocation.providerKind,
  dbPath: invocation.dbPath,
  approval: { policy: 'ask', askTools: invocation.askTools },
})

if (invocation.web) {
  root.plugin(webUi, {
    port: invocation.port,
    agentOptions: { provider: invocation.provider, model: invocation.model },
  })
  // The listening server keeps the process alive; Ctrl+C stops it.
} else if (invocation.list) {
  const listings = root.sessionPersistence.list()
  if (listings.length === 0) {
    console.log('no stored sessions')
  }
  for (const listing of listings) {
    console.log(`${listing.id}  events=${listing.eventCount}  created=${new Date(listing.createdAt).toISOString()}`)
  }
  process.exit(0)
} else {
  // Progress goes to stderr; only the outcome goes to stdout.
  root.on('session/event', (_session, event) => {
    if (event.type === 'tool/call') console.error(`  [tool] ${event.data.name} ${event.data.arguments}`)
    if (event.type === 'tool/result') console.error(`  [tool] -> ${event.data.error === undefined ? 'ok' : `error (${event.data.error.name})`}`)
    if (event.type === 'approval/decided') console.error(`  [approval] ${event.data.id} -> ${event.data.outcome}`)
  })
  root.on('agent/error', (_agent, error) => {
    console.error('  [agent error]', error instanceof Error ? error.message : error)
  })

  const agentOptions = { provider: invocation.provider, model: invocation.model }
  const agent = invocation.resume === undefined
    ? root.agents.create({ agentOptions })
    : root.agents.enter(
        root.sessions.create(SessionId(invocation.resume), root.sessionPersistence.load(SessionId(invocation.resume))),
        agentOptions,
      )

  agent.followup(createUserMessage({ content: [{ type: 'text', text: invocation.task }] }))
  await agent.whenIdle()

  const outcome = summarize(agent.session.events)
  console.log(outcome.text)
  console.error(`  [session] ${agent.session.id} (${agent.session.seq} events)`)
  process.exit(outcome.reasonKind === 'completed' ? 0 : 1)
}
