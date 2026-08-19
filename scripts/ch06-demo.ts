import { readFile, rm } from 'node:fs/promises'
import { Context } from '@mini-dsh/cordis'
import { AgentRegistry } from '@mini-dsh/agent'
import { createUserMessage, SessionStore } from '@mini-dsh/core'
import { LocalFileSystem, toolFs } from '@mini-dsh/fs'
import { LlmRuntime, MockAdapter } from '@mini-dsh/llm'
import { LocalShellExecutor, toolShell } from '@mini-dsh/shell'
import { persona, SystemPrompt, wireTools } from '@mini-dsh/system-prompt'
import { ToolRuntime } from '@mini-dsh/tools'

await rm('tmp-ch06', { recursive: true, force: true })

const root = new Context()
root.plugin(SessionStore)
root.plugin(LlmRuntime)
root.plugin(ToolRuntime)
root.plugin(SystemPrompt)
root.plugin(LocalFileSystem)
root.plugin(LocalShellExecutor)
root.plugin(toolFs)
root.plugin(toolShell)
root.plugin(persona, { text: 'You are mini-dsh, a helpful coding agent.' })
root.plugin(wireTools)
root.plugin(AgentRegistry)

// The scripted "model": step 0 calls the write tool, step 1 concludes.
root.plugin({
  name: 'llm-mock',
  inject: ['llm'],
  apply: (ctx) => {
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      [
        { text: 'Writing the file now.' },
        { toolCall: { id: 'call-1', name: 'write', arguments: '{"file_path":"tmp-ch06/greeting.txt","content":"hello agent"}' } },
      ],
      [{ text: 'Done - greeting.txt contains the greeting.' }],
    ]))
  },
})

// Watch the durable log as the loop runs.
root.on('session/event', (_session, event) => {
  console.log(`  [log] seq=${event.seq} ${event.type}`)
})

const agent = root.agents.create({ agentOptions: { provider: 'mock', model: 'mock-1' } })
agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Create tmp-ch06/greeting.txt saying "hello agent".' }] }))
await agent.whenIdle()

// Verify the WORLD, not the model's self-report (a rule the real repo's tests enforce).
const onDisk = await readFile('tmp-ch06/greeting.txt', 'utf8')
console.log(`file on disk: "${onDisk}"`)

const finalAssistant = agent.session
  .deriveMessages()
  .filter((message) => message.role === 'assistant')
  .at(-1)
const text = finalAssistant?.content.find((block) => block.type === 'text')
console.log(`final assistant text: "${text !== undefined && 'text' in text ? text.text : ''}"`)
console.log(`events in log: ${agent.session.seq}, agent status: ${agent.status}`)
