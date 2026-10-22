/**
 * Per-tool "required" overrides.
 *
 * The global `required` switch is the default; a tool named in this document
 * uses its own boolean instead. Only explicit entries are stored, so clearing
 * an override makes the tool follow the global switch again.
 * @module @xiaoso/dsh-tool-step-note/tool-required
 */

/**
 * Parse the per-tool required document. Malformed JSON and non-boolean values
 * are ignored; an absent document means every tool follows the global switch.
 * @param value - raw setting text.
 * @returns tool name to whether the note is required.
 */
export function parseToolRequired(value: string | undefined): Map<string, boolean> {
  const text = (value ?? '').trim()
  if (text === '') return new Map()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return new Map()
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return new Map()
  const out = new Map<string, boolean>()
  for (const [name, required] of Object.entries(parsed)) {
    const tool = name.trim()
    if (tool !== '' && typeof required === 'boolean') out.set(tool, required)
  }
  return out
}

/**
 * Serialize overrides in a stable form: sorted keys, every explicit value.
 * @param required - tool name to whether the note is required.
 * @returns the stored JSON string.
 */
export function serializeToolRequired(required: ReadonlyMap<string, boolean>): string {
  const out: Record<string, boolean> = {}
  for (const name of [...required.keys()].sort()) out[name] = required.get(name) === true
  return JSON.stringify(out)
}
