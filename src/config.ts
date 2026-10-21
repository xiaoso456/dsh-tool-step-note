/**
 * Step Note settings: which tools receive the description argument, whether it
 * is required, the prompt shown to the model, and which tools with an existing
 * description get that prompt replaced.
 *
 * The plugin entry id is the settings namespace (`step-note`). Every field is
 * declared volatile so the settings service can commit a browser write into
 * the running entry without a remount.
 * @module @xiaoso/dsh-tool-step-note/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/**
 * The Loader commits a settings write into this plugin's live config
 * references and announces the changed paths on the owning fiber. The
 * declaration lives in the Loader package, which a business plugin does not
 * depend on, so the one event this module consumes is spelled here — copied
 * verbatim from the Loader's own declaration, so a future signature change
 * fails loudly here instead of silently missing the notification.
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Volatile config values were committed into the running fiber without a remount; dispatched to the owning fiber only.
     * @param paths - changed config paths as key arrays; every value is committed before dispatch.
     * @mode emit
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * Protocol key `@deepseek-ai/cosmokit` stamps on a live config reference.
 * `Symbol.for` keeps the check valid across copies of the shared library.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Every field this plugin owns is a boolean or a string. */
type FieldValue = boolean | string | undefined

/**
 * Whether a parsed value is one of the Loader's live config references.
 * @param value - a parsed config value.
 * @returns whether the value is a live reference.
 */
export function isLiveField(value: unknown): value is Volatile<FieldValue> {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value
}

/** Default: the plugin rewrites schemas. */
export const DEFAULT_ENABLED = true

/** Default: the argument is optional; the user can make it required. */
export const DEFAULT_REQUIRED = false

/** Default prompt the model sees for a newly added description argument. */
export const DEFAULT_PROMPT =
  "One short sentence describing what this step does or is about to do, in the user's language. Shown next to the step in the UI."

/** Default tools that receive the argument; the common first-party tools. */
export const DEFAULT_ENABLED_TOOLS: readonly string[] = ['edit', 'read', 'write', 'bash', 'pwsh']

/** Existing tool descriptions are kept unless the user opts in per tool. */
export const DEFAULT_OVERRIDE_TOOLS: readonly string[] = []

/** Plugin settings, one scalar key per option. */
export interface Config {
  /** Whether the assembly transform runs at all. */
  enabled?: boolean
  /** Whether the description argument is required (run_code is always required). */
  required?: boolean
  /** Prompt shown to the model for the description argument. */
  prompt?: string
  /** JSON array (or comma-separated list) of tool names to rewrite. */
  enabledTools?: string
  /** JSON array (or comma-separated list) of tools whose existing description prompt is replaced. */
  overrideTools?: string
}

/** Settings schema; every field is writable through the shared settings form. */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_ENABLED).volatile(),
  required: z.boolean().default(DEFAULT_REQUIRED).volatile(),
  prompt: z.string().default(DEFAULT_PROMPT).volatile(),
  enabledTools: z.string().default(JSON.stringify(DEFAULT_ENABLED_TOOLS)).volatile(),
  overrideTools: z.string().default(JSON.stringify(DEFAULT_OVERRIDE_TOOLS)).volatile(),
})

/** Live entry config: what the Loader hands `apply`, one stable reference per field. */
export type LiveConfig = ReturnType<typeof Config>

/** The fully-resolved settings the transform consumes. */
export interface ResolvedConfig {
  enabled: boolean
  required: boolean
  prompt: string
  enabledTools: ReadonlySet<string>
  overrideTools: ReadonlySet<string>
}

/**
 * Parse a tool-name setting. Accepts a JSON array (the settings page's format)
 * or a comma-separated list (hand-written cordis.yml).
 * @param value - raw setting text.
 * @param fallback - names used when the setting is absent or blank.
 * @returns the configured tool names.
 */
function parseToolNames(value: string | undefined, fallback: readonly string[]): Set<string> {
  const text = (value ?? '').trim()
  if (text === '') return new Set(fallback)
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(item => item !== ''))
      }
    } catch {
      // Malformed JSON falls through to the comma-separated form.
    }
  }
  return new Set(text.split(',').map(item => item.trim()).filter(item => item !== ''))
}

/**
 * Parse the enabled-tools setting; blank means the default set.
 * @param value - raw setting text.
 * @returns the configured tool names.
 */
export function parseEnabledTools(value: string | undefined): Set<string> {
  return parseToolNames(value, DEFAULT_ENABLED_TOOLS)
}

/**
 * Parse the override-tools setting; blank means no overrides.
 * @param value - raw setting text.
 * @returns the tools whose existing description prompt is replaced.
 */
export function parseOverrideTools(value: string | undefined): Set<string> {
  return parseToolNames(value, DEFAULT_OVERRIDE_TOOLS)
}

/**
 * Unwrap the Loader's live field references into a plain settings document.
 * @param input - the entry's live config, or an already-plain document.
 * @returns a plain copy carrying the fields the input has.
 */
function plainFields(input: Config | LiveConfig): Config {
  const out: Config = {}
  for (const [field, value] of Object.entries(input)) {
    Object.assign(out, { [field]: isLiveField(value) ? value.get() : value })
  }
  return out
}

/**
 * Resolve the composition entry to the settings the transform consumes.
 * @param input - the entry's live config, or a plain (possibly partial) document.
 * @returns the fully-defaulted settings.
 */
export function resolveConfig(input: Config | LiveConfig): ResolvedConfig {
  const config = plainFields(input)
  const prompt = (config.prompt ?? '').trim()
  return {
    enabled: config.enabled ?? DEFAULT_ENABLED,
    required: config.required ?? DEFAULT_REQUIRED,
    prompt: prompt === '' ? DEFAULT_PROMPT : prompt,
    enabledTools: parseEnabledTools(config.enabledTools),
    overrideTools: parseOverrideTools(config.overrideTools),
  }
}
