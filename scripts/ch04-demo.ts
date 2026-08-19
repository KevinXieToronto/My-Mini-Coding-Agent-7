import { Context } from '@mini-dsh/cordis'
import { createUserMessage } from '@mini-dsh/core'
import { BlockAssembler, LlmRuntime, MockAdapter } from '@mini-dsh/llm'

const root = new Context()
root.plugin(LlmRuntime)

// Provider plugin: routes the 'mock' provider name to a scripted adapter.
root.plugin({
  name: 'llm-mock',
  inject: ['llm'],
  apply: (ctx) => {
    ctx.llm.registerAdapter(['mock'], new MockAdapter([
      [{ text: 'Thinking... ' }, { toolCall: { id: 'call-1', name: 'read', arguments: '{"file_path":"a.txt"}' } }],
      [{ text: 'All done.' }],
    ]))
  },
})

// Seam middleware: counts chunks flowing through EVERY model request.
// A waterfall listener that only observes MUST call next().
let observed = 0
root.plugin({
  name: 'chunk-counter',
  inject: ['llm'],
  apply: (ctx) => {
    ctx.on('llm/stream', (options, next) => {
      async function* count(inner: ReturnType<typeof next>) {
        for await (const chunk of inner) {
          observed += 1
          yield chunk
        }
      }
      return count(next())
    })
  },
})

console.log('providers:', root.llm.listProviders())

async function requestOnce(text: string): Promise<void> {
  const assembler = new BlockAssembler()
  const stream = root.llm.stream({
    provider: 'mock',
    model: 'mock-1',
    messages: [createUserMessage({ content: [{ type: 'text', text }] })],
  })
  for await (const chunk of stream) assembler.push(chunk)
  const blocks = assembler.blocks()
  console.log(
    `finish=${assembler.finish?.kind}`,
    `usage=${assembler.usage?.inputTokens}/${assembler.usage?.outputTokens}`,
    'blocks:',
    blocks.map((block) => (block.type === 'tool-call' ? `tool-call(${block.name} ${block.arguments})` : `${block.type}("${'text' in block ? block.text : ''}")`)).join(', '),
  )
}

await requestOnce('please read a.txt')
await requestOnce('and now?')
console.log('chunks observed by middleware:', observed)

// Unknown providers surface as a terminal error finish chunk, not an exception.
const bad = new BlockAssembler()
try {
  for await (const chunk of root.llm.stream({ provider: 'nope', model: 'x', messages: [] })) bad.push(chunk)
} catch (error) {
  console.log('unknown provider threw synchronously:', error instanceof Error ? error.message : error)
}
