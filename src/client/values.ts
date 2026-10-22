/**
 * Value helpers shared by the Step Note settings section.
 * @module @xiaoso/dsh-tool-step-note/client
 */

/** The plain settings document the shared form carries. */
export interface StepNoteValue {
  enabled?: boolean
  required?: boolean
  /** Replace the native tool cards so the note persists (off by default). */
  toolRows?: boolean
  prompt?: string
  enabledTools?: string
  toolPrompts?: string
}

/** Schema defaults returned by the host route. */
export interface StepNoteDefaults {
  enabled: boolean
  required: boolean
  toolRows: boolean
  prompt: string
  enabledTools: string
  toolPrompts: string
}

/** The editable projection of one settings snapshot. */
export interface StepNoteDraft {
  enabled: boolean
  required: boolean
  toolRows: boolean
  prompt: string
  tools: ReadonlySet<string>
  /** Tool name to its own prompt; absent means follow the tool or global prompt. */
  prompts: ReadonlyMap<string, string>
}

/**
 * Parse a tool-name setting. Mirrors the host's accepted formats.
 * @param value - JSON array or comma-separated list.
 * @returns the configured names.
 */
export function parseToolNames(value: string | undefined): Set<string> {
  const text = (value ?? '').trim()
  if (text === '') return new Set()
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
 * Serialize a name set in the stable JSON form the host parses.
 * @param names - selected tool names.
 * @returns the stored string.
 */
export function serializeToolNames(names: ReadonlySet<string>): string {
  return JSON.stringify([...names].sort())
}

/**
 * Parse a per-tool prompt setting. Mirrors the host: malformed JSON and
 * non-string values are ignored.
 * @param value - JSON object mapping tool names to prompts.
 * @returns tool name to prompt, with blank prompts omitted.
 */
export function parseToolPrompts(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  const text = (value ?? '').trim()
  if (text === '') return out
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return out
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out
  for (const [name, prompt] of Object.entries(parsed)) {
    const tool = name.trim()
    if (tool === '' || typeof prompt !== 'string') continue
    const trimmed = prompt.trim()
    if (trimmed !== '') out.set(tool, trimmed)
  }
  return out
}

/**
 * Serialize per-tool prompts in a stable form: sorted keys, trimmed values.
 * @param prompts - tool name to its own prompt.
 * @returns the stored JSON string.
 */
export function serializeToolPrompts(prompts: ReadonlyMap<string, string>): string {
  const out: Record<string, string> = {}
  for (const name of [...prompts.keys()].sort()) {
    const prompt = (prompts.get(name) ?? '').trim()
    if (prompt !== '') out[name] = prompt
  }
  return JSON.stringify(out)
}

/**
 * Project one settings snapshot onto the editable shape.
 * @param value - schema-resolved settings, or undefined before the first load.
 * @returns the draft.
 */
export function draftFromValue(value: StepNoteValue | undefined): StepNoteDraft {
  return {
    enabled: value?.enabled !== false,
    required: value?.required === true,
    toolRows: value?.toolRows === true,
    prompt: value?.prompt ?? '',
    tools: parseToolNames(value?.enabledTools),
    prompts: parseToolPrompts(value?.toolPrompts),
  }
}

/**
 * Project the host's schema defaults onto the editable shape.
 * @param defaults - defaults returned by the tool-list route.
 * @returns the draft that Save turns back into the default document.
 */
export function draftFromDefaults(defaults: StepNoteDefaults): StepNoteDraft {
  return {
    enabled: defaults.enabled,
    required: defaults.required,
    toolRows: defaults.toolRows === true,
    prompt: defaults.prompt,
    tools: parseToolNames(defaults.enabledTools),
    prompts: parseToolPrompts(defaults.toolPrompts),
  }
}

/**
 * Compare two drafts, including both collections.
 * @param a - first draft.
 * @param b - second draft.
 * @returns whether they describe the same settings.
 */
export function sameDraft(a: StepNoteDraft, b: StepNoteDraft): boolean {
  if (a.enabled !== b.enabled || a.required !== b.required || a.toolRows !== b.toolRows || a.prompt !== b.prompt) return false
  if (a.tools.size !== b.tools.size || a.prompts.size !== b.prompts.size) return false
  for (const name of a.tools) if (!b.tools.has(name)) return false
  for (const [name, prompt] of a.prompts) if (b.prompts.get(name) !== prompt) return false
  return true
}
