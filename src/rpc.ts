/**
 * Host route that lists the tools the settings page can toggle.
 *
 * The route is read-only metadata: the page needs the roster before the first
 * model request, while `system-prompt/assemble` only reveals tools as they are
 * actually assembled. It rides a child row with a static `inject` list because
 * the web plane is mounted after this plugin applies; a CLI-only deployment
 * simply never applies the row. Trust policy is the Connection service's own
 * loopback fence.
 * @module @xiaoso/dsh-tool-step-note/rpc
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** One tool as the settings page needs it. */
export interface ToolListEntry {
  name: string
  /** Why this tool's card is replaced by default, or why it is not. */
  cardReason: 'nativeShows' | 'nativeDrops' | 'resultCard' | 'customRow' | 'generic' | 'noNote'
  /** Whether the built-in defaults replace this tool's card. */
  cardDefault: boolean
  /** Shadow priority the built-in defaults use for this tool. */
  cardPriority: number
  description: string
  /** The tool declares `additionalProperties: false`, so the argument cannot be added. */
  strict: boolean
  /** The tool comes from an MCP server; its server may reject the extra argument. */
  mcp: boolean
  /** The schema already defines a top-level `description` argument. */
  hasDescription: boolean
  /** The tool's current description prompt, when the property carries one. */
  descriptionPrompt?: string
  /** The property accepts a plain string, so its prompt can be replaced. */
  overridable: boolean
  /** `description` is currently in the schema's `required` list. */
  descriptionRequired: boolean
}

/** The reserved PTC transport, which is not a registry entry. */
export interface RunCodeEntry {
  /** Whether the host has seen the real run_code schema; false uses the built-in fallback. */
  known: boolean
  /** The prompt currently attached to the argument. */
  prompt: string
  /** Whether the prompt can be replaced. */
  overridable: boolean
  /** run_code's executor always requires the argument. */
  required: true
}

/** Schema defaults, used by the page's staged "restore defaults" action. */
export interface StepNoteDefaults {
  enabled: boolean
  required: boolean
  /** Resolved prompt language of these defaults. */
  language: 'zh' | 'en'
  prompt: string
  enabledTools: string
  /** JSON object mapping a tool name to its own prompt. */
  toolPrompts: string
  /** JSON object mapping a tool name to its card policy. */
  toolCards: string
  /** JSON object mapping a tool name to a required override; blank follows `required`. */
  toolRequired: string
}

/** Everything the settings page reads in one request. */
export interface ToolListPayload {
  tools: ToolListEntry[]
  runCode: RunCodeEntry
  defaults: StepNoteDefaults
}

/** Structural view of a host web route (no build-time coupling to its package). */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Structural view of the slice of the Connection service used here. */
interface ConnectionLike {
  /** 401/403 for a request outside the trust fence, undefined when allowed. */
  requestRejection(req: IncomingMessage): number | undefined
}

/** Prefix owned by this plugin. */
const ROUTE_PREFIX = '/step-note'

/** The roster endpoint. */
const TOOLS_ENDPOINT = `${ROUTE_PREFIX}/tools`

/** The browser reports the active interface language here (no persistence). */
const LANGUAGE_ENDPOINT = `${ROUTE_PREFIX}/active-language`

/** The languages the defaults exist for. */
export type ReportedLanguage = 'zh' | 'en'

/** Write one JSON response. */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

/**
 * Read the small JSON body of a language report.
 * @param req - the incoming request.
 * @returns the reported language, or undefined when malformed.
 */
function readReportedLanguage(req: IncomingMessage): Promise<ReportedLanguage | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024) {
        resolve(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { language?: unknown }
        resolve(body.language === 'zh' || body.language === 'en' ? body.language : undefined)
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => { resolve(undefined) })
  })
}

/**
 * Install the tool-list route. Returns a disposer that removes the route; the
 * child row itself is owned by `ctx` and disposed with it.
 * @param ctx - plugin context owning the child row.
 * @param list - reads the current roster, sorted by name.
 * @param report - records the interface language the browser reports.
 * @returns a disposer for the route registration.
 */
export function installToolListRoute(
  ctx: Context,
  list: () => ToolListPayload,
  report?: (language: ReportedLanguage) => void,
): () => void {
  let disposer: (() => void) | undefined

  ctx.plugin({
    name: 'step-note-tool-list',
    // Both services are required: the route is served by the web server and
    // the trust fence comes from Connection.
    inject: ['connection', 'webServer'],
    apply: (rowCtx: Context): void => {
      const connection = (rowCtx as unknown as { connection: ConnectionLike }).connection
      const server = (rowCtx as unknown as { webServer: WebServerLike }).webServer

      try {
        disposer = server.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: (req: IncomingMessage, res: ServerResponse): void => {
            const rejection = connection.requestRejection(req)
            if (rejection !== undefined) {
              res.statusCode = rejection
              res.end()
              return
            }
            const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
            if (pathname === LANGUAGE_ENDPOINT) {
              if (req.method !== 'POST') {
                res.setHeader('allow', 'POST')
                sendJson(res, 405, { error: 'method-not-allowed' })
                return
              }
              void readReportedLanguage(req).then((language) => {
                if (language === undefined) {
                  sendJson(res, 400, { error: 'invalid-language' })
                  return
                }
                report?.(language)
                res.statusCode = 204
                res.end()
              })
              return
            }
            if (pathname !== TOOLS_ENDPOINT) {
              sendJson(res, 404, { error: 'not-found' })
              return
            }
            if (req.method !== 'GET') {
              res.setHeader('allow', 'GET')
              sendJson(res, 405, { error: 'method-not-allowed' })
              return
            }
            sendJson(res, 200, list())
          },
        })
      } catch (error) {
        // The page degrades to its load-error state; the rest of the plugin is
        // unaffected. Never silent: a swallowed registration failure is the
        // kind of signal that costs an afternoon later.
        disposer = undefined
        console.warn('[step-note] tool list route unavailable:', error instanceof Error ? error.message : String(error))
      }
    },
  })

  return () => {
    disposer?.()
    disposer = undefined
  }
}
