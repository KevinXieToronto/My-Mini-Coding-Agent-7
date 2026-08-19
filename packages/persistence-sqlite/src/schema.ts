import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Bump on ANY schema change. Policy: reject foreign versions, never migrate silently. */
export const SCHEMA_VERSION = 1

/** Marks the file as ours ('MDSH' in ASCII) so we never misread a stranger's database. */
export const APPLICATION_ID = 0x4d445348

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')

  const readPragma = (name: string): number =>
    Number((db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[name])
  const onDiskVersion = readPragma('user_version')
  const onDiskAppId = readPragma('application_id')

  if (onDiskVersion === 0 && onDiskAppId === 0) {
    // Fresh file: claim it and create the schema.
    db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        cwd TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        time INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      ) STRICT;
    `)
    return db
  }
  if (onDiskAppId !== APPLICATION_ID) {
    db.close()
    throw new Error(`"${path}" is not a mini-dsh session database (application_id mismatch)`)
  }
  if (onDiskVersion !== SCHEMA_VERSION) {
    db.close()
    throw new Error(
      `session database "${path}" has schema version ${onDiskVersion}, incompatible with this build (${SCHEMA_VERSION})`,
    )
  }
  return db
}
