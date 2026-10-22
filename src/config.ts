/**
 * Step Note settings: which tools receive the description argument, whether it
 * is required, the global prompt shown to the model, and optional per-tool
 * prompts that replace the global or a tool's own description prompt.
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

/** Default: the native tool cards stay untouched. */
export const DEFAULT_TOOL_ROWS = false

/** Default prompt the model sees for a newly added description argument. */
export const DEFAULT_PROMPT =
  '用中文一句话描述已经完成了什么，为了达到什么最终目标，接下来要做什么。'

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

/** Per-tool prompts for the common tools that need a narrower instruction. */
export const DEFAULT_TOOL_PROMPTS = JSON.stringify({
  bash: '用中文主动语态，简明说明这条命令在做什么，控制在 5 到 15 个词（会显示在界面上）。示例："ls" → "列出当前目录中的文件"；"git status" → "查看工作树状态"；"npm install" → "安装项目依赖"。',
  pwsh: '用中文主动语态，简明说明这条命令在做什么，控制在 5 到 15 个词（会显示在界面上）。示例："ls" → "列出当前目录中的文件"；"git status" → "查看工作树状态"；"Get-Process" → "列出正在运行的进程"。',
  run_code: '用中文主动语态，简明说明这段程序在做什么，控制在 5 到 15 个词（会显示在界面上）。示例："统计各包中的 TODO 标记"；"读取失败的测试及其夹具"；"重命名每个 cordis.yml 里的配置键"。',
})

/** Plugin settings, one scalar key per option. */
export interface Config {
  /** Whether the assembly transform runs at all. */
  enabled?: boolean
  /** Whether the description argument is required (run_code is always required). */
  required?: boolean
  /** Whether the chat replaces the flash-only tools' cards with the note row (native cards cannot show it). */
  toolRows?: boolean
  /** Prompt shown to the model for the description argument. */
  prompt?: string
  /** JSON array (or comma-separated list) of tool names to rewrite. */
  enabledTools?: string
  /** JSON object mapping a tool name to that tool's own prompt. */
  toolPrompts?: string
}

/** Settings schema; every field is writable through the shared settings form. */
export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_ENABLED).volatile(),
  required: z.boolean().default(DEFAULT_REQUIRED).volatile(),
  toolRows: z.boolean().default(DEFAULT_TOOL_ROWS).volatile(),
  prompt: z.string().default(DEFAULT_PROMPT).volatile(),
  enabledTools: z.string().default(JSON.stringify(DEFAULT_ENABLED_TOOLS)).volatile(),
  toolPrompts: z.string().default(DEFAULT_TOOL_PROMPTS).volatile(),
})

/** Live entry config: what the Loader hands `apply`, one stable reference per field. */
export type LiveConfig = ReturnType<typeof Config>

/** The fully-resolved settings the transform consumes. */
export interface ResolvedConfig {
  enabled: boolean
  required: boolean
  toolRows: boolean
  prompt: string
  enabledTools: ReadonlySet<string>
  /** Tool name to its own prompt; absent means follow the tool or global prompt. */
  toolPrompts: ReadonlyMap<string, string>
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
    toolRows: config.toolRows ?? DEFAULT_TOOL_ROWS,
    prompt: prompt === '' ? DEFAULT_PROMPT : prompt,
    enabledTools: parseEnabledTools(config.enabledTools),
    toolPrompts: parseToolPrompts(config.toolPrompts, parseToolPrompts(DEFAULT_TOOL_PROMPTS)),
  }
}
