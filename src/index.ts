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
  DEFAULT_PROMPT,
  DEFAULT_REQUIRED,
  DEFAULT_TOOL_PROMPTS,
  DEFAULT_TOOL_ROWS,
  resolveConfig,
  type ResolvedConfig,
} from './config.ts'
import { admitsString, injectDescription, isRecord } from './inject.ts'
import {
  installToolListRoute,
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

/** Built-in PTC prompt used only before the host has assembled run_code. */
const DEFAULT_RUN_CODE_PROMPT = '用中文主动语态，简明说明这段程序在做什么，控制在 5 到 15 个词（会显示在界面上）。示例："统计各包中的 TODO 标记"；"读取失败的测试及其夹具"；"重命名每个 cordis.yml 里的配置键"。'

/** Schema defaults the page stages behind its "restore defaults" action. */
const DEFAULTS: StepNoteDefaults = {
  enabled: DEFAULT_ENABLED,
  required: DEFAULT_REQUIRED,
  toolRows: DEFAULT_TOOL_ROWS,
  prompt: DEFAULT_PROMPT,
  enabledTools: JSON.stringify(DEFAULT_ENABLED_TOOLS),
  toolPrompts: DEFAULT_TOOL_PROMPTS,
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
  return {
    name: tool.name,
    description: tool.description,
    strict: isRecord(parameters) && parameters.additionalProperties === false,
    mcp: tool.name.startsWith('mcp__'),
    hasDescription: current !== undefined,
    overridable: record !== undefined
      && admitsString(record.type)
      && record.enum === undefined
      && record.const === undefined,
    descriptionRequired,
    ...(descriptionPrompt === undefined ? {} : { descriptionPrompt }),
  }
}

/** The reserved PTC transport as the page's dedicated card. */
function runCodeInfo(seen: ReadonlyMap<string, ToolSchema>, live: readonly ToolSchema[]): RunCodeEntry {
  const schema = seen.get('run_code') ?? live.find(item => item.name === 'run_code')
  if (schema === undefined) {
    return { known: false, prompt: DEFAULT_RUN_CODE_PROMPT, overridable: true, required: true }
  }
  const described = describe(schema)
  return {
    known: true,
    prompt: described.descriptionPrompt ?? DEFAULT_RUN_CODE_PROMPT,
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
  let current: ResolvedConfig = resolveConfig(config)
  // The roster outlives one assembly: the page can be opened before the first
  // request, and agent-scoped tools only appear while their agent assembles.
  const seen = new Map<string, ToolSchema>()
  for (const schema of ctx.tools.schemas()) seen.set(schema.name, schema)

  // A committed settings write is folded into the same config references in
  // place; the Loader dispatches this to the owning fiber only.
  ctx.on('loader/volatile-update', () => {
    current = resolveConfig(config)
  })

  ctx.on('system-prompt/assemble', async (_assembly, _assembleContext, next) => {
    const resolved = await next()
    for (const schema of resolved.tools) seen.set(schema.name, schema)
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
    return {
      tools: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
      runCode: runCodeInfo(seen, live),
      defaults: DEFAULTS,
    }
  }

  ctx.effect(() => installToolListRoute(ctx, list), 'step-note: tool list route')

  // This plugin owns its settings page; the settings service must not
  // auto-generate a schema page for the entry.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      'step-note: own settings page',
    )
  })
}
