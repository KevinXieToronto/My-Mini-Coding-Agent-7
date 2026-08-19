// Optional real-API smoke test. Self-skips without a key — the same
// convention the real repo uses for its with-key e2e tests.
import { Context } from '@mini-dsh/cordis'
import { createUserMessage } from '@mini-dsh/core'
import { BlockAssembler, LlmRuntime } from '@mini-dsh/llm'
import * as llmDeepSeek from '@mini-dsh/llm-deepseek'

if (process.env['DEEPSEEK_API_KEY'] === undefined || process.env['DEEPSEEK_API_KEY'] === '') {
  console.log('DEEPSEEK_API_KEY is not set - skipping the real API demo.')
  process.exit(0)
}

const root = new Context()
root.plugin(LlmRuntime)
root.plugin(llmDeepSeek)

const assembler = new BlockAssembler()
const stream = root.llm.stream({
  provider: 'deepseek',
  model: 'deepseek-chat',
  messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply with exactly: OK' }] })],
  maxTokens: 16,
})
for await (const chunk of stream) {
  if (chunk.type === 'text-delta') process.stdout.write(chunk.text)
  assembler.push(chunk)
}
console.log(`\nfinish=${assembler.finish?.kind} usage=${assembler.usage?.inputTokens}/${assembler.usage?.outputTokens}`)
