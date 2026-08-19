import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Context } from '@mini-dsh/cordis'
import type { AgentOptions } from '@mini-dsh/agent'
import { createUserMessage, SessionId } from '@mini-dsh/core'
import { PAGE_HTML } from './page.ts'

export interface Config {
  host?: string
  port?: number
  agentOptions: AgentOptions
}

export const name = 'web-ui'
export const inject = ['agents', 'sessions'] as const

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>)
}

export function apply(ctx: Context, config: Config): void {
  const host = config.host ?? '127.0.0.1'
  const port = config.port ?? 3080

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(PAGE_HTML)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/prompt') {
      const body = await readJsonBody(request)
      const text = typeof body['text'] === 'string' ? body['text'] : ''
      if (text.trim() === '') {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'text is required' }))
        return
      }
      const requestedId = typeof body['sessionId'] === 'string' ? SessionId(body['sessionId']) : undefined
      const agent =
        (requestedId !== undefined ? ctx.agents.get(requestedId) : undefined) ??
        ctx.agents.create({ agentOptions: config.agentOptions })
      agent.followup(createUserMessage({ content: [{ type: 'text', text }] }))
      response.writeHead(202, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ sessionId: agent.session.id }))
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      const id = url.searchParams.get('session')
      const session = id === null ? undefined : ctx.sessions.get(SessionId(id))
      if (session === undefined) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: `unknown session "${id ?? ''}"` }))
        return
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      })
      // Snapshot + subscribe with no await in between (single-threaded, so no
      // event can slip into the gap), then stream every future append live.
      const snapshot = [...session.events]
      const dispose = ctx.on('session/event', (eventSession, event) => {
        if (eventSession.id === session.id) {
          response.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      })
      for (const event of snapshot) response.write(`data: ${JSON.stringify(event)}\n\n`)
      request.on('close', dispose)
      return
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: `no route for ${request.method ?? ''} ${url.pathname}` }))
  }

  // The server is an effect: disposing the plugin closes the port.
  ctx.effect(() => {
    const server = createServer((request, response) => {
      void handler(request, response).catch((error: unknown) => {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      })
    })
    server.listen(port, host, () => {
      console.log(`mini-dsh web ui listening on http://${host}:${port}`)
    })
    return () => {
      server.close()
    }
  }, 'web-ui.server')
}
