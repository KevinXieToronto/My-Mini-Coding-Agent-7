import { Context } from '@mini-dsh/cordis'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  SessionStore,
} from '@mini-dsh/core'

const root = new Context()
root.plugin(SessionStore)

// Observe the log the way persistence will in Chapter 08.
root.on('session/event', (session, event) => {
  console.log(`  [log] seq=${event.seq} ${event.type}`)
})

const session = root.sessions.create()
console.log('new session, seq =', session.seq)

// Simulate one full turn: user asks, model calls a tool, tool answers, model concludes.
session.append('turn/start', { turn: 0 })
session.append('step/start', { turn: 0, step: 0 })
session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'What is in data.txt?' }] }))
const callId = CallId('call-1')
session.append('assistant/message', {
  turn: 0,
  step: 0,
  message: createAssistantMessage({
    content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{"file_path":"data.txt"}' }],
    source: { kind: 'model', provider: 'mock', model: 'mock-1' },
  }),
})
session.append('tool/call', { turn: 0, step: 0, callId, name: 'read', arguments: '{"file_path":"data.txt"}' })
session.append('tool/result', {
  turn: 0,
  step: 0,
  message: createToolResultMessage({
    callId,
    toolName: 'read',
    content: [{ type: 'text', text: 'hello from data.txt' }],
  }),
})
session.append('step/end', { turn: 0, step: 0 })
session.append('step/start', { turn: 0, step: 1 })
session.append('assistant/message', {
  turn: 0,
  step: 1,
  message: createAssistantMessage({
    content: [{ type: 'text', text: 'data.txt says: hello from data.txt' }],
    source: { kind: 'model', provider: 'mock', model: 'mock-1' },
  }),
})
session.append('step/end', { turn: 0, step: 1 })
session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })

// 1. The model-visible conversation is DERIVED from the log.
const derived = session.deriveMessages()
console.log('derived conversation:', derived.map((m) => `${m.role}(${m.content[0]!.type})`).join(' -> '))

// 2. Events are immutable: mutating a committed event throws.
try {
  ;(session.events[0] as { seq: number }).seq = 99
  console.log('immutability: FAILED (mutation was allowed)')
} catch {
  console.log('immutability: OK (frozen event rejected mutation)')
}

// 3. Replay: seed a second session from the first one's events — the derived
//    conversation must be identical. This is exactly how resume works in Chapter 08.
const replayed = root.sessions.create(undefined, session.events)
const same =
  JSON.stringify(replayed.deriveMessages().map((m) => ({ role: m.role, content: m.content }))) ===
  JSON.stringify(derived.map((m) => ({ role: m.role, content: m.content })))
console.log(`replayed session: seq=${replayed.seq}, firstLiveSeq=${replayed.firstLiveSeq}, derived identical=${same}`)
