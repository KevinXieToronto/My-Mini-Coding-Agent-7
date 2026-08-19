import type { SessionEvent } from '@mini-dsh/core'

export interface Outcome {
  text: string
  reasonKind: string
}

/**
 * Derive the run outcome purely from the session log (the real headless
 * runner does exactly this): last assistant text + last turn-end reason.
 */
export function summarize(events: readonly SessionEvent[]): Outcome {
  let text = ''
  let reasonKind = 'unknown'
  for (const event of events) {
    if (event.type === 'assistant/message') {
      const flattened = event.data.message.content
        .filter((block): block is Extract<(typeof event.data.message.content)[number], { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (flattened.length > 0) text = flattened
    }
    if (event.type === 'turn/end') {
      reasonKind = event.data.reason.kind
    }
  }
  return { text, reasonKind }
}
