import type { DatabaseSync } from 'node:sqlite'
import { Service, type Context } from '@mini-dsh/cordis'
import type { SessionEvent, SessionId } from '@mini-dsh/core'
import { openDatabase } from './schema.ts'

export * from './schema.ts'

export interface SessionListing {
  id: SessionId
  createdAt: number
  cwd: string
  eventCount: number
}

declare module '@mini-dsh/cordis' {
  interface Context {
    sessionPersistence: SqliteSessionPersistence
  }
}

export interface Config {
  /** Database file path; ':memory:' is supported for tests. */
  path: string
}

/**
 * Persistence is a SUBSCRIBER: it never drives sessions, it only mirrors
 * session/created and session/event into SQLite, and reads seeds back out.
 */
export class SqliteSessionPersistence extends Service {
  static inject = ['sessions'] as const

  private db: DatabaseSync

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionPersistence')
    this.db = openDatabase(config.path)
    ctx.effect(() => () => this.db.close(), 'sessionPersistence.close')

    ctx.on('session/created', (session) => {
      // OR IGNORE: a resumed session's row already exists.
      this.db
        .prepare('INSERT OR IGNORE INTO sessions (id, created_at, cwd) VALUES (?, ?, ?)')
        .run(String(session.id), Date.now(), process.cwd())
    })
    ctx.on('session/event', (session, event) => {
      this.db
        .prepare('INSERT INTO events (session_id, seq, type, time, data) VALUES (?, ?, ?, ?, ?)')
        .run(String(session.id), event.seq, event.type, event.time, JSON.stringify(event.data))
    })
  }

  list(): SessionListing[] {
    const rows = this.db
      .prepare(`
        SELECT s.id AS id, s.created_at AS createdAt, s.cwd AS cwd, COUNT(e.seq) AS eventCount
        FROM sessions s LEFT JOIN events e ON e.session_id = s.id
        GROUP BY s.id ORDER BY s.created_at
      `)
      .all() as unknown as { id: string; createdAt: number; cwd: string; eventCount: number }[]
    return rows.map((row) => ({ ...row, id: row.id as SessionId }))
  }

  /** Read a stored session back as a seed, validating seq contiguity. */
  load(id: SessionId): SessionEvent[] {
    const rows = this.db
      .prepare('SELECT seq, type, time, data FROM events WHERE session_id = ? ORDER BY seq')
      .all(String(id)) as unknown as { seq: number; type: string; time: number; data: string }[]
    if (rows.length === 0) {
      throw new Error(`no stored session "${id}"`)
    }
    return rows.map((row, index) => {
      if (row.seq !== index) {
        throw new Error(`corrupt session log for "${id}": expected seq ${index}, found ${row.seq}`)
      }
      return {
        type: row.type,
        seq: row.seq,
        time: row.time,
        data: JSON.parse(row.data),
      } as SessionEvent
    })
  }
}
