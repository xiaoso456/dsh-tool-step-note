/**
 * Value helpers shared by the Step Note settings section.
 * @module @xiaoso/dsh-tool-step-note/client
 */

/** The plain settings document the shared form carries. */
export interface StepNoteValue {
  enabled?: boolean
  required?: boolean
  prompt?: string
  enabledTools?: string
  overrideTools?: string
}

/** Schema defaults returned by the host route. */
export interface StepNoteDefaults {
  enabled: boolean
  required: boolean
  prompt: string
  enabledTools: string
  overrideTools: string
}

/** The editable projection of one settings snapshot. */
export interface StepNoteDraft {
  enabled: boolean
  required: boolean
  prompt: string
  tools: ReadonlySet<string>
  overrides: ReadonlySet<string>
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
 * Project one settings snapshot onto the editable shape.
 * @param value - schema-resolved settings, or undefined before the first load.
 * @returns the draft.
 */
export function draftFromValue(value: StepNoteValue | undefined): StepNoteDraft {
  return {
    enabled: value?.enabled !== false,
    required: value?.required === true,
    prompt: value?.prompt ?? '',
    tools: parseToolNames(value?.enabledTools),
    overrides: parseToolNames(value?.overrideTools),
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
    prompt: defaults.prompt,
    tools: parseToolNames(defaults.enabledTools),
    overrides: parseToolNames(defaults.overrideTools),
  }
}

/**
 * Compare two drafts, including both name sets.
 * @param a - first draft.
 * @param b - second draft.
 * @returns whether they describe the same settings.
 */
export function sameDraft(a: StepNoteDraft, b: StepNoteDraft): boolean {
  if (a.enabled !== b.enabled || a.required !== b.required || a.prompt !== b.prompt) return false
  if (a.tools.size !== b.tools.size || a.overrides.size !== b.overrides.size) return false
  for (const name of a.tools) if (!b.tools.has(name)) return false
  for (const name of a.overrides) if (!b.overrides.has(name)) return false
  return true
}
