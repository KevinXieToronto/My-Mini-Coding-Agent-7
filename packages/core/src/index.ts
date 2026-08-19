import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@mini-dsh/cordis'
import type { Branded } from './brand.ts'
import {
  deepFreeze,
  type AssistantMessage,
  type CallId,
  type Message,
  type ToolResultMessage,
  type UserMessage,
} from './message.ts'

export * from './brand.ts'
export * from './message.ts'

export type SessionId = Branded<'SessionId'>
export function SessionId(id: string): SessionId {
  return id as SessionId
}

export type TurnEndReason =
  | { kind: 'completed' }
  | { kind: 'aborted' }
  | { kind: 'max-tokens' }
  | { kind: 'error'; message: string }

/**
 * The durable event vocabulary. Merge-extensible: plugins add their own
 * entries via declaration merging (Chapter 09 adds approval/* events).
 * A turn is zero or more steps; a step is one model request plus its tool calls.
 */
export interface SessionEventMap {
  'turn/start': { turn: number }
  'turn/end': { turn: number; reason: TurnEndReason }
  'step/start': { turn: number; step: number }
  'step/end': { turn: number; step: number }
  'user/message': UserMessage
  'assistant/message': { turn: number; step: number; message: AssistantMessage }
  'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string }
  'tool/result': {
    turn: number
    step: number
    message: ToolResultMessage
    error?: { name: string; message: string }
  }
}

export type SessionEventType = keyof SessionEventMap

/** One immutable log record. `seq` is contiguous from 0 — seq === log.length at append. */
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    readonly type: K
    readonly seq: number
    readonly time: number
    readonly data: SessionEventMap[K]
  }
}[T]

export class Session {
  private log: SessionEvent[] = []
  /** Events at seq < firstLiveSeq came from a replayed seed, not this process. */
  readonly firstLiveSeq: number

  constructor(
    readonly id: SessionId,
    private readonly onEvent: (session: Session, event: SessionEvent) => void,
    seed?: readonly SessionEvent[],
  ) {
    if (seed !== undefined) {
      seed.forEach((event, index) => {
        if (event.seq !== index) {
          throw new Error(`corrupt session seed for "${id}": event at index ${index} has seq ${event.seq}`)
        }
      })
      this.log = seed.map((event) => deepFreeze(structuredClone(event)) as SessionEvent)
    }
    this.firstLiveSeq = this.log.length
  }

  /** Monotonic next sequence number — always equals the log length. */
  get seq(): number {
    return this.log.length
  }

  get events(): readonly SessionEvent[] {
    return this.log
  }

  /**
   * Append one immutable event. The data is detached (structuredClone) so the
   * caller cannot mutate the log afterwards, then deep-frozen.
   */
  append<T extends SessionEventType>(type: T, data: SessionEventMap[T]): SessionEvent<T> {
    const event = deepFreeze({
      type,
      seq: this.log.length,
      time: Date.now(),
      data: structuredClone(data),
    }) as SessionEvent<T>
    this.log.push(event)
    this.onEvent(this, event)
    return event
  }

  /**
   * Fold the log into the model-visible conversation. This is THE projection
   * the agent loop uses to build every model request: user messages,
   * non-empty assistant messages, and tool results — in log order.
   */
  deriveMessages(): Message[] {
    const messages: Message[] = []
    for (const event of this.log) {
      switch (event.type) {
        case 'user/message':
          messages.push(event.data)
          break
        case 'assistant/message':
          if (event.data.message.content.length > 0) messages.push(event.data.message)
          break
        case 'tool/result':
          messages.push(event.data.message)
          break
      }
    }
    return messages
  }
}

declare module '@mini-dsh/cordis' {
  interface Context {
    sessions: SessionStore
  }
  interface Events {
    'session/created'(session: Session): void
    /** Emitted after every append, post-commit. Persistence subscribes here. */
    'session/event'(session: Session, event: SessionEvent): void
  }
}

export class SessionStore extends Service {
  private store = new Map<SessionId, Session>()

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  /** Create a fresh session, or resume one by replaying a seed of past events. */
  create(id?: SessionId, seed?: readonly SessionEvent[]): Session {
    const sessionId = id ?? SessionId(`session-${randomUUID()}`)
    if (this.store.has(sessionId)) {
      throw new Error(`session "${sessionId}" already exists`)
    }
    const session = new Session(sessionId, (s, e) => this.ctx.emit('session/event', s, e), seed)
    this.store.set(sessionId, session)
    this.ctx.emit('session/created', session)
    return session
  }

  get(id: SessionId): Session | undefined {
    return this.store.get(id)
  }

  list(): Session[] {
    return [...this.store.values()]
  }
}
