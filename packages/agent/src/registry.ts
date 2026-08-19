import { Service, type Context } from '@mini-dsh/cordis'
import type { Session, SessionId } from '@mini-dsh/core'
import { Agent, type AgentOptions } from './agent.ts'

declare module '@mini-dsh/cordis' {
  interface Context {
    agents: AgentRegistry
  }
}

export class AgentRegistry extends Service {
  static inject = ['sessions', 'llm', 'tools', 'systemPrompt'] as const

  private store = new Map<SessionId, Agent>()

  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  /** Create an agent on a fresh session. Agent id === session id, as in the real repo. */
  create(options: { sessionId?: SessionId; agentOptions: AgentOptions }): Agent {
    const session = this.ctx.sessions.create(options.sessionId)
    return this.enter(session, options.agentOptions)
  }

  /** Attach an agent to an existing (e.g. replayed) session — used by persistence in Chapter 08. */
  enter(session: Session, agentOptions: AgentOptions): Agent {
    if (this.store.has(session.id)) {
      throw new Error(`an agent for session "${session.id}" already exists`)
    }
    const agent = new Agent(this.ctx, session, agentOptions)
    this.store.set(session.id, agent)
    this.ctx.emit('agent/created', agent)
    return agent
  }

  get(id: SessionId): Agent | undefined {
    return this.store.get(id)
  }

  list(): Agent[] {
    return [...this.store.values()]
  }
}
