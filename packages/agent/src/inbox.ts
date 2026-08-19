import type { UserMessage } from '@mini-dsh/core'

export type InboxTarget = 'next-turn' | 'next-step'

/**
 * Where user messages wait for the loop to claim them. `next-turn` messages
 * start/extend turns; `next-step` messages (steering) are injected between
 * steps of the running turn.
 */
export class Inbox {
  private nextTurn: UserMessage[] = []
  private nextStep: UserMessage[] = []

  push(target: InboxTarget, message: UserMessage): void {
    if (target === 'next-turn') this.nextTurn.push(message)
    else this.nextStep.push(message)
  }

  /** Claiming empties the relevant queues; a turn opening claims both. */
  claim(target: InboxTarget): UserMessage[] {
    const claimed = target === 'next-turn' ? [...this.nextTurn, ...this.nextStep] : [...this.nextStep]
    if (target === 'next-turn') this.nextTurn = []
    this.nextStep = []
    return claimed
  }

  get hasPending(): boolean {
    return this.nextTurn.length > 0 || this.nextStep.length > 0
  }
}
