/**
 * Tool-card replacement policy, shared by the Host (roster route, defaults) and
 * the browser half (which tools get a shadow row and at what priority).
 *
 * A keyed `tool.call.toolview` entry wins its cell only when its priority is
 * the lowest; the shipped rows are 0, so our rows use a negative priority.
 * Priority is per entry, so every tool can carry its own.
 * @module @xiaoso/dsh-tool-step-note
 */

/** Default shadow priority; any value below the shipped 0 wins. */
export const CARD_PRIORITY_DEFAULT = -1000

/** Lowest accepted priority (inclusive). */
export const CARD_PRIORITY_MIN = -1_000_000

/** Highest accepted priority; 0 is the shipped row, so ours must stay below it. */
export const CARD_PRIORITY_MAX = -1

/** One tool's card replacement policy. */
export interface ToolCardConfig {
  /** Whether this plugin draws the row instead of the native one. */
  replace: boolean
  /** Shadow priority; lower renders first. */
  priority: number
}

/** Why a tool's card is replaced by default, or why it is not. */
export type ToolCardReason = 'nativeShows' | 'nativeDrops' | 'resultCard' | 'customRow' | 'generic' | 'noNote'

/** Tools whose native row renders the model-written description. */
const NATIVE_SHOWS = new Set(['bash', 'pwsh', 'run_code', 'grep', 'glob', 'web_search'])

/** Tools whose native row shows a path or URL instead of the description. */
const NATIVE_DROPS = new Set(['read', 'write', 'edit', 'web_fetch', 'read_image'])

/** Tools whose native row is a structured result/details card. */
const RESULT_CARD = new Set([
  'job_list', 'job_output', 'job_kill',
  'create_goal', 'get_goal', 'update_goal',
  'schedule_create', 'schedule_list', 'schedule_delete', 'schedule_update',
  'subagent', 'list_subagent_models', 'send_message',
  'todo_write', 'workflow', 'ralph', 'lsp',
])
const RESULT_CARD_PREFIXES = ['team_', 'terminal_', 'session_', 'cordis_', 'subagent_']

/** Tools whose native row is a dedicated interactive card. */
const CUSTOM_ROW = new Set(['ask_user_question', 'skill', 'present'])

/** Default policy: the three official file tools replace; everything else keeps its native row. */
export const DEFAULT_TOOL_CARDS: ReadonlyMap<string, ToolCardConfig> = new Map([
  ['read', { replace: true, priority: CARD_PRIORITY_DEFAULT }],
  ['write', { replace: true, priority: CARD_PRIORITY_DEFAULT }],
  ['edit', { replace: true, priority: CARD_PRIORITY_DEFAULT }],
])

/** Clamp one priority into the accepted range. */
export function clampCardPriority(value: number): number {
  return Math.min(CARD_PRIORITY_MAX, Math.max(CARD_PRIORITY_MIN, Math.round(value)))
}

/**
 * Classify why a tool's card should or should not be replaced.
 * @param name - wire tool name.
 * @param flags - schema facts the roster already reports.
 * @returns the reason key the settings page localizes.
 */
export function toolCardReason(name: string, flags: { strict: boolean; hasDescription: boolean; overridable: boolean }): ToolCardReason {
  if (flags.strict || (flags.hasDescription && !flags.overridable)) return 'noNote'
  if (NATIVE_DROPS.has(name)) return 'nativeDrops'
  if (NATIVE_SHOWS.has(name)) return 'nativeShows'
  if (RESULT_CARD.has(name) || RESULT_CARD_PREFIXES.some(prefix => name.startsWith(prefix))) return 'resultCard'
  if (CUSTOM_ROW.has(name)) return 'customRow'
  return 'generic'
}

/**
 * Parse the stored tool-card map. A blank value means the built-in defaults;
 * malformed input also falls back to them.
 * @param value - stored JSON object: tool name to {replace, priority}.
 * @param defaults - map used when the value is blank or unusable.
 * @returns the effective map.
 */
export function parseToolCards(value: string | undefined, defaults: ReadonlyMap<string, ToolCardConfig> = DEFAULT_TOOL_CARDS): Map<string, ToolCardConfig> {
  const text = (value ?? '').trim()
  if (text === '') return new Map(defaults)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return new Map(defaults)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map(defaults)
  const out = new Map<string, ToolCardConfig>()
  for (const [rawName, rawEntry] of Object.entries(parsed)) {
    const name = rawName.trim()
    if (name === '') continue
    if (rawEntry === false) continue
    if (rawEntry === true) {
      out.set(name, { replace: true, priority: CARD_PRIORITY_DEFAULT })
      continue
    }
    if (typeof rawEntry !== 'object' || rawEntry === null) continue
    const entry = rawEntry as { replace?: unknown; priority?: unknown }
    if (entry.replace === false) continue
    const priority = typeof entry.priority === 'number' && Number.isFinite(entry.priority)
      ? clampCardPriority(entry.priority)
      : CARD_PRIORITY_DEFAULT
    out.set(name, { replace: true, priority })
  }
  return out
}

/**
 * Serialize a card map in the stable form the Host parses.
 * @param cards - tool name to its policy.
 * @returns JSON with sorted keys, replace always true for present entries.
 */
export function serializeToolCards(cards: ReadonlyMap<string, ToolCardConfig>): string {
  const out: Record<string, { replace: true; priority: number }> = {}
  for (const name of [...cards.keys()].sort()) {
    const card = cards.get(name)
    if (card === undefined || !card.replace) continue
    out[name] = { replace: true, priority: clampCardPriority(card.priority) }
  }
  return JSON.stringify(out)
}
