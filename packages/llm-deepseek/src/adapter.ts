import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@mini-dsh/llm'
import { serializeRequest } from './serialize.ts'
import { parseSse, translate } from './stream.ts'

export interface DeepSeekConnection {
  apiKey: string
  baseURL: string
}

/** Transport only: connection details come from a hook, re-read on every call. */
export class DeepSeekAdapter extends LlmAdapter {
  constructor(private readonly resolveConnection: () => DeepSeekConnection) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const connection = this.resolveConnection()
    const response = await fetch(`${connection.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${connection.apiKey}`,
        'content-type': 'application/json',
        'accept': 'text/event-stream',
      },
      body: JSON.stringify(serializeRequest(options)),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300)
      throw new Error(`DeepSeek API error ${response.status}: ${detail}`)
    }
    if (response.body === null) {
      throw new Error('DeepSeek API returned no response body')
    }
    yield* translate(parseSse(response.body))
  }
}
