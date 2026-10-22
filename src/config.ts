/**
 * Step Note settings: which tools receive the description argument, whether it
 * is required, the default prompt language, the global prompt shown to the
 * model, optional per-tool prompts, and which native tool cards this plugin
 * replaces.
 *
 * Language-dependent defaults live in prompts.ts: Chinese translates the
 * built-in prompts of bash/pwsh/run_code, English keeps every tool's own
 * description. A blank prompt/toolPrompts value means "use the language
 * default", so switching the language moves the defaults with it.
 *
 * The plugin entry id is the settings namespace (`step-note`). Every field is
 * declared volatile so the settings service can commit a browser write into
 * the running entry without a remount.
 * @module @xiaoso/dsh-tool-step-note/config
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { languagePrompts, type PromptLanguage } from './prompts.ts'
import { DEFAULT_TOOL_CARDS, parseToolCards, type ToolCardConfig } from './tool-cards.ts'
import { parseToolRequired } from './tool-required.ts'

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

/** How the default prompt language is chosen: follow the UI locale preference. */
export type LanguageSetting = 'auto' | PromptLanguage

/** Default: follow the UI language. */
export const DEFAULT_LANGUAGE: LanguageSetting = 'auto'

/** Default tools that receive the argument; the common first-party tools. */
export const DEFAULT_ENABLED_TOOLS: readonly string[] = [
  'edit',
  'read',
  'write',
  'bash',
  'pwsh',
  'grep',
  'glob',
  'job_list',
  'job_output',
  'job_kill',
]

/** Plugin settings, one scalar key per option. */
export interface Config {
  /** Whether the assembly transform runs at all. */
  enabled?: boolean
  /** Whether the description argument is required (run_code is always required). */
  required?: boolean
  /** Default prompt language: `auto` follows the UI locale, otherwise `zh` or `en`. */
  language?: string
  /** Global prompt; blank uses the language default. */
  prompt?: string
  /** JSON array (or comma-separated list) of tool names to rewrite. */
  enabledTools?: string
  /** JSON object mapping a tool name to that tool's own prompt; blank uses the language defaults. */
  toolPrompts?: string
  /** JSON object mapping a tool name to {replace, priority}; blank uses the built-in defaults. */
  toolCards?: string
  /** JSON object mapping a tool name to whether the note is required; absent follows `required`. */
  toolRequired?: string
}

/** Settings schema; every field is writable through the shared settings form. */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_ENABLED).volatile(),
  required: z.boolean().default(DEFAULT_REQUIRED).volatile(),
  language: z.string().default(DEFAULT_LANGUAGE).volatile(),
  prompt: z.string().default('').volatile(),
  enabledTools: z.string().default(JSON.stringify(DEFAULT_ENABLED_TOOLS)).volatile(),
  toolPrompts: z.string().default('').volatile(),
  toolCards: z.string().default('').volatile(),
  toolRequired: z.string().default('').volatile(),
})

/** Live entry config: what the Loader hands `apply`, one stable reference per field. */
export type LiveConfig = ReturnType<typeof Config>

/** The fully-resolved settings the transform and the browser layer consume. */
export interface ResolvedConfig {
  enabled: boolean
  required: boolean
  /** Resolved prompt language (never `auto`). */
  language: PromptLanguage
  prompt: string
  enabledTools: ReadonlySet<string>
  /** Tool name to its own prompt; absent means follow the tool or global prompt. */
  toolPrompts: ReadonlyMap<string, string>
  /** Tool name to its card replacement policy. */
  cards: ReadonlyMap<string, ToolCardConfig>
  /** Tool name to a required override; absent follows `required`. */
  toolRequired: ReadonlyMap<string, boolean>
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
 * Parse the per-tool prompt setting. Malformed JSON or non-string values fall
 * back to no per-tool prompts rather than breaking every model request.
 * @param value - raw setting text.
 * @param fallback - prompts used when the setting is absent or blank.
 * @returns tool name to prompt, with blank prompts omitted.
 */
export function parseToolPrompts(value: string | undefined, fallback: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const text = (value ?? '').trim()
  if (text === '') return new Map(fallback)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return new Map(fallback)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map(fallback)
  const out = new Map<string, string>()
  for (const [name, prompt] of Object.entries(parsed)) {
    const tool = name.trim()
    if (tool === '' || typeof prompt !== 'string') continue
    const trimmed = prompt.trim()
    if (trimmed !== '') out.set(tool, trimmed)
  }
  return out
}

/**
 * Resolve the prompt language: an explicit `zh`/`en` wins, otherwise the
 * UI locale preference (the `locale` settings namespace) decides. Without a
 * preference, Chinese stays the default.
 * @param setting - the plugin's `language` field.
 * @param preference - the UI locale preference, when one is configured.
 * @returns the resolved language.
 */
export function resolveLanguage(setting: string | undefined, preference: string | undefined): PromptLanguage {
  if (setting === 'zh' || setting === 'en') return setting
  const normalized = (preference ?? '').toLowerCase()
  if (normalized.startsWith('zh')) return 'zh'
  if (normalized !== '') return 'en'
  return 'zh'
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
 * Blank prompt fields take the resolved language's defaults; an explicitly
 * saved document (even `{}`) replaces them.
 * @param input - the entry's live config, or a plain (possibly partial) document.
 * @param language - the resolved prompt language.
 * @returns the fully-defaulted settings.
 */
export function resolveConfig(input: Config | LiveConfig, language: PromptLanguage): ResolvedConfig {
  const config = plainFields(input)
  const defaults = languagePrompts(language)
  const prompt = (config.prompt ?? '').trim() || defaults.prompt
  const rawPrompts = (config.toolPrompts ?? '').trim()
  return {
    enabled: config.enabled ?? DEFAULT_ENABLED,
    required: config.required ?? DEFAULT_REQUIRED,
    language,
    prompt,
    enabledTools: parseEnabledTools(config.enabledTools),
    toolPrompts: rawPrompts === ''
      ? new Map(defaults.toolPrompts)
      : parseToolPrompts(config.toolPrompts, new Map()),
    cards: parseToolCards(config.toolCards, DEFAULT_TOOL_CARDS),
    toolRequired: parseToolRequired(config.toolRequired),
  }
}
