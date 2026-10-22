/**
 * Step Note, host half: adds a model-written `description` argument to the
 * schemas of the enabled tools. The chat step row already reads that key
 * (`LIVE_TOOL_DETAIL_KEYS` in `dsh-client-ui-chat`), so the description shows
 * without any client-side change.
 *
 * The rewrite happens after every `system-prompt/assemble` listener has run,
 * so the result is exactly what the model receives. It is deterministic for a
 * given config, which keeps the request header stable and the prompt cache
 * warm. The tool validator uses the registration-time schema, not this one;
 * tools that reject unknown arguments are skipped by the transform.
 * @module @xiaoso/dsh-tool-step-note
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the `system-prompt/assemble` event into the Context.
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only: pulls the `ctx.tools` Context merge.
import type {} from '@deepseek-ai/dsh-tools'
// Type-only: pulls the `ctx.settings` Context merge.
import type {} from '@deepseek-ai/dsh-settings'
import {
  Config,
  DEFAULT_ENABLED,
  DEFAULT_ENABLED_TOOLS,
  DEFAULT_REQUIRED,
  isLiveField,
  resolveConfig,
  resolveLanguage,
  type ResolvedConfig,
} from './config.ts'
import { languagePrompts, type PromptLanguage } from './prompts.ts'
import { CARD_PRIORITY_DEFAULT, DEFAULT_TOOL_CARDS, serializeToolCards, toolCardReason } from './tool-cards.ts'
import { admitsString, injectDescription, isRecord } from './inject.ts'
import {
  installToolListRoute,
  type ReportedLanguage,
  type RunCodeEntry,
  type StepNoteDefaults,
  type ToolListEntry,
  type ToolListPayload,
} from './rpc.ts'

/** Plugin name (also the composition row name in this package's patch). */
export const name = 'step-note'

/** The assembly listener needs the tool registry; the route row declares its own services. */
export const inject = ['tools']

export { Config }

/** The schema fields the settings page needs from any registered tool. */
interface ToolDescriptor {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** One registry layer: the tools registered at one scope. */
interface ToolLayerLike {
  tools: { entries(): IterableIterator<[string, ToolDescriptor]> }
}

/**
 * The registry's own layer map. `ToolRuntime.schemas()` projects ONE scope, and
 * the public API has no "every scope" enumeration; the layer map is the
 * complete roster. The read is defensive so a private-field rename degrades to
 * the global view plus the tools seen in assemblies instead of breaking the
 * page.
 */
interface ToolRuntimeInternals {
  layers?: {
    global?: ToolLayerLike
    scoped?: Map<unknown, ToolLayerLike>
  }
}

/** The PTC executor's own English prompt, used when no language default names run_code. */
const BUILTIN_RUN_CODE_PROMPT = 'Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: "Count TODO markers across packages"; "Read failing test and its fixture"; "Rename config key in every cordis.yml".'

/** The prompt run_code carries before the host has assembled it, for one language. */
function runCodeDefaultPrompt(language: PromptLanguage): string {
  return languagePrompts(language).toolPrompts.get('run_code') ?? BUILTIN_RUN_CODE_PROMPT
}

/** Schema defaults the page stages behind its "restore defaults" action. */
function defaultsFor(language: PromptLanguage): StepNoteDefaults {
  const prompts = languagePrompts(language)
  return {
    enabled: DEFAULT_ENABLED,
    required: DEFAULT_REQUIRED,
    language,
    prompt: prompts.prompt,
    enabledTools: JSON.stringify(DEFAULT_ENABLED_TOOLS),
    toolPrompts: JSON.stringify(Object.fromEntries(prompts.toolPrompts)),
    toolCards: serializeToolCards(DEFAULT_TOOL_CARDS),
    toolRequired: '',
  }
}

/** Structural view of the settings service slice used for locale detection. */
interface SettingsLike {
  describe?: () => readonly { ns: string; value?: unknown }[]
}

/**
 * Read the UI locale preference from the `locale` settings namespace.
 * The settings service is optional here: a headless deployment without it
 * keeps the Chinese defaults.
 * @param service - the settings service, when the host provides it.
 * @returns the configured preference, when one exists.
 */
function readLocalePreference(service: SettingsLike | undefined): string | undefined {
  const settings = service
  if (settings === undefined || typeof settings.describe !== 'function') return undefined
  try {
    const row = settings.describe().find(item => item.ns === 'locale')
    const value = row?.value
    if (typeof value !== 'object' || value === null) return undefined
    const preference = (value as { preference?: unknown }).preference
    return typeof preference === 'string' ? preference : undefined
  } catch {
    return undefined
  }
}

/** Describe one registered tool for the settings page. */
function describe(tool: ToolDescriptor): ToolListEntry {
  const parameters = tool.parameters
  const properties = isRecord(parameters) && isRecord(parameters.properties) ? parameters.properties : undefined
  const current = properties?.['description']
  const record = isRecord(current) ? current : undefined
  const descriptionPrompt = record !== undefined && typeof record.description === 'string' ? record.description : undefined
  const descriptionRequired = isRecord(parameters)
    && Array.isArray(parameters.required)
    && parameters.required.includes('description')
  const strict = isRecord(parameters) && parameters.additionalProperties === false
  const overridable = record !== undefined
    && admitsString(record.type)
    && record.enum === undefined
    && record.const === undefined
  const cardDefault = DEFAULT_TOOL_CARDS.get(tool.name)
  return {
    name: tool.name,
    description: tool.description,
    strict,
    mcp: tool.name.startsWith('mcp__'),
    hasDescription: current !== undefined,
    overridable,
    descriptionRequired,
    cardReason: toolCardReason(tool.name, { strict, hasDescription: current !== undefined, overridable }),
    cardDefault: cardDefault !== undefined,
    cardPriority: cardDefault?.priority ?? CARD_PRIORITY_DEFAULT,
    ...(descriptionPrompt === undefined ? {} : { descriptionPrompt }),
  }
}

/** The reserved PTC transport as the page's dedicated card. */
function runCodeInfo(seen: ReadonlyMap<string, ToolSchema>, live: readonly ToolSchema[], language: PromptLanguage): RunCodeEntry {
  const fallback = runCodeDefaultPrompt(language)
  const schema = seen.get('run_code') ?? live.find(item => item.name === 'run_code')
  if (schema === undefined) {
    return { known: false, prompt: fallback, overridable: true, required: true }
  }
  const described = describe(schema)
  return {
    known: true,
    prompt: described.descriptionPrompt ?? fallback,
    overridable: described.overridable,
    required: true,
  }
}

/**
 * Mount the host half.
 * @param ctx - plugin context.
 * @param config - the entry's live config (one stable reference per field).
 */
export function apply(ctx: Context, config: Config = {}): void {
  // The settings service is optional: a headless deployment without it keeps
  // the Chinese defaults. Reading it without an injection is forbidden by the
  // framework, so the child row below captures the service handle.
  let settings: SettingsLike | undefined
  // The browser half reports its active interface language on boot and on
  // every locale switch. It is only a fallback: a persisted locale preference
  // always wins, and nothing is written to the settings store.
  let reportedLanguage: ReportedLanguage | undefined

  // `auto` follows the UI locale preference, so the language is re-read on
  // every commit and every assembly: no restart is needed to follow the UI.
  const languageOf = (): PromptLanguage => {
    const field = isLiveField(config.language) ? config.language.get() : config.language
    const preference = readLocalePreference(settings) ?? reportedLanguage
    return resolveLanguage(typeof field === 'string' ? field : undefined, preference)
  }
  let current: ResolvedConfig = resolveConfig(config, languageOf())
  // The roster outlives one assembly: the page can be opened before the first
  // request, and agent-scoped tools only appear while their agent assembles.
  const seen = new Map<string, ToolSchema>()
  for (const schema of ctx.tools.schemas()) seen.set(schema.name, schema)

  // A committed settings write is folded into the same config references in
  // place; the Loader dispatches this to the owning fiber only.
  ctx.on('loader/volatile-update', () => {
    current = resolveConfig(config, languageOf())
  })

  ctx.on('system-prompt/assemble', async (_assembly, _assembleContext, next) => {
    const resolved = await next()
    for (const schema of resolved.tools) seen.set(schema.name, schema)
    // The locale preference can move without a config commit (another plugin
    // writes it), so the language is resolved per request too.
    current = resolveConfig(config, languageOf())
    if (!current.enabled) return resolved

    let changed = false
    const tools = resolved.tools.map((schema) => {
      const result = injectDescription(schema, current)
      if (result.changed) changed = true
      return result.schema
    })
    return changed ? { ...resolved, tools } : resolved
  })

  const list = (): ToolListPayload => {
    const entries = new Map<string, ToolListEntry>()
    const merge = (tool: ToolDescriptor): void => {
      const next = describe(tool)
      const previous = entries.get(next.name)
      if (previous === undefined) {
        entries.set(next.name, next)
        return
      }
      // One name can exist in several scopes. Show a field as strict or
      // existing if ANY variant has it, so enabling a name cannot silently
      // skip one preset; keep the first prompt found.
      entries.set(next.name, {
        ...next,
        strict: previous.strict || next.strict,
        hasDescription: previous.hasDescription || next.hasDescription,
        overridable: previous.overridable || next.overridable,
        descriptionRequired: previous.descriptionRequired || next.descriptionRequired,
        ...(next.descriptionPrompt !== undefined
          ? { descriptionPrompt: next.descriptionPrompt }
          : previous.descriptionPrompt === undefined ? {} : { descriptionPrompt: previous.descriptionPrompt }),
      })
    }

    // The registry's layer map is the complete roster across every preset and
    // agent scope. The visible global view alone lists only globally registered
    // tools, which is why the page used to show two entries.
    const internals = ctx.tools as unknown as ToolRuntimeInternals
    const layers = internals.layers
    if (layers !== undefined) {
      if (layers.global !== undefined) {
        for (const [, tool] of layers.global.tools.entries()) merge(tool)
      }
      if (layers.scoped instanceof Map) {
        for (const layer of layers.scoped.values()) {
          for (const [, tool] of layer.tools.entries()) merge(tool)
        }
      }
    }

    // Fallbacks: the tools seen in past assemblies (notably run_code, which is
    // a reserved transport rather than a registry entry), then the live global
    // view, which wins over an old assembly snapshot.
    for (const schema of seen.values()) merge(schema)
    const live = ctx.tools.schemas()
    for (const schema of live) merge(schema)
    const language = languageOf()
    return {
      tools: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
      runCode: runCodeInfo(seen, live, language),
      defaults: defaultsFor(language),
    }
  }

  ctx.effect(
    () => installToolListRoute(ctx, list, (language) => { reportedLanguage = language }),
    'step-note: tool list route',
  )

  // This plugin owns its settings page; the settings service must not
  // auto-generate a schema page for the entry. The same row captures the
  // service for locale reads (a property access outside an injection throws).
  ctx.inject(['settings'], (settingsCtx) => {
    settings = settingsCtx.settings as unknown as SettingsLike
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'step-note: own settings page',
    )
    settingsCtx.effect(
      () => () => { settings = undefined },
      'step-note: release settings handle',
    )
  })
}
