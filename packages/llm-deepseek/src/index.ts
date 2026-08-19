import type { Context } from '@mini-dsh/cordis'
import { DeepSeekAdapter } from './adapter.ts'

export * from './adapter.ts'

export const PUBLIC_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
export const BASE_URL_ENV = 'DEEPSEEK_BASE_URL'

export interface Config {
  provider?: string
  baseURL?: string
  apiKeyEnv?: string
}

export const name = 'llm-deepseek'
export const inject = ['llm'] as const

export function apply(ctx: Context, config: Config = {}): void {
  const provider = config.provider ?? 'deepseek'
  const adapter = new DeepSeekAdapter(() => {
    const apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
    const apiKey = process.env[apiKeyEnv]
    if (apiKey === undefined || apiKey === '') {
      throw new Error(`missing credential: set the ${apiKeyEnv} environment variable`)
    }
    return {
      apiKey,
      baseURL: config.baseURL ?? process.env[BASE_URL_ENV] ?? PUBLIC_BASE_URL,
    }
  })
  ctx.llm.registerAdapter([provider], adapter)
}
