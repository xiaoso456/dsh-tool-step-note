/**
 * The assembly transform: add a model-written `description` argument to one
 * tool schema without changing the tool's registered validation.
 *
 * Tools that already define a top-level `description` argument keep their own
 * prompt unless `toolPrompts` names them; a named tool gets that text instead.
 * A tool without a description gets the global prompt. `run_code` is a special
 * case: its built-in prompt stays unless `toolPrompts` names it.
 *
 * Tool execution validates against the schema captured at registration
 * (`defineTool`), not against the assembled schema, so a first-party tool whose
 * parameter root is an implicit open object accepts the extra key at run time.
 * Tools that declare `additionalProperties: false` are skipped because their
 * validator would reject the argument.
 * @module @xiaoso/dsh-tool-step-note/inject
 */

import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig } from './config.ts'

/** Why one schema was left untouched. */
export type InjectionSkip = 'strict' | 'shape' | 'not-enabled'

/** Result of transforming one tool schema. */
export interface InjectionResult {
  /** The schema to expose; the input reference when nothing changed. */
  schema: ToolSchema
  /** Whether the model-visible schema differs from the input. */
  changed: boolean
  /** Set when the tool was skipped rather than rewritten. */
  skipped?: InjectionSkip
}

/** The argument name the client's step row already reads. */
const DESCRIPTION = 'description'

/**
 * Whether a value is a non-array object.
 * @param value - any JSON value.
 * @returns whether the value is a plain record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether a JSON Schema `type` admits strings. An absent type is accepted
 * because the property may inherit one from the surrounding schema.
 * @param type - the raw `type` value.
 * @returns whether a string value is valid for the property.
 */
export function admitsString(type: unknown): boolean {
  return type === undefined || type === 'string' || (Array.isArray(type) && type.includes('string'))
}

/**
 * Add, refresh, or leave the description argument in one tool schema. Pure:
 * the input schema is never mutated.
 * @param schema - one assembled tool schema.
 * @param config - resolved plugin settings.
 * @returns the schema to expose and whether it changed.
 */
export function injectDescription(schema: ToolSchema, config: ResolvedConfig): InjectionResult {
  const isRunCode = schema.name === 'run_code'
  if (!isRunCode && !config.enabledTools.has(schema.name)) {
    return { schema, changed: false, skipped: 'not-enabled' }
  }

  const parameters = schema.parameters
  if (!isRecord(parameters)) return { schema, changed: false, skipped: 'shape' }

  const declaredType = parameters.type
  const objectTyped = declaredType === 'object'
    || (Array.isArray(declaredType) && declaredType.includes('object'))
  if (declaredType !== undefined && !objectTyped) return { schema, changed: false, skipped: 'shape' }

  if (parameters.additionalProperties === false) return { schema, changed: false, skipped: 'strict' }

  const properties = parameters.properties
  if (properties !== undefined && !isRecord(properties)) return { schema, changed: false, skipped: 'shape' }

  const current = isRecord(properties) ? properties[DESCRIPTION] : undefined
  if (current !== undefined) {
    if (!isRecord(current)) return { schema, changed: false, skipped: 'shape' }
    if (!admitsString(current.type)) return { schema, changed: false, skipped: 'shape' }
    if (current.enum !== undefined || current.const !== undefined) return { schema, changed: false, skipped: 'shape' }
  }

  const required = Array.isArray(parameters.required) ? parameters.required : undefined
  const alreadyRequired = required !== undefined && required.includes(DESCRIPTION)
  // run_code's executor rejects an empty description, so its requirement is a
  // fixed protocol rule rather than a setting.
  const requireIt = isRunCode || (config.toolRequired?.get(schema.name) ?? config.required)
  const requiredChanged = requireIt && !alreadyRequired
  const customPrompt = config.toolPrompts.get(schema.name)
  const currentDescription = isRecord(current) && typeof current.description === 'string'
    ? current.description
    : undefined
  const prompt = customPrompt ?? config.prompt
  const override = customPrompt !== undefined
  const descriptionChanged = current === undefined || (override && currentDescription !== customPrompt)
  if (!descriptionChanged && !requiredChanged) return { schema, changed: false }

  let nextProperties: Record<string, unknown>
  if (current === undefined) {
    // New argument first so it reads as the step's one-line intent.
    nextProperties = {
      [DESCRIPTION]: { type: 'string', description: prompt },
      ...(isRecord(properties) ? properties : {}),
    }
  } else if (override) {
    // In place: an existing field keeps its position and any extra keywords.
    nextProperties = {
      ...(properties as Record<string, unknown>),
      [DESCRIPTION]: {
        ...current,
        ...(current.type === undefined ? { type: 'string' } : {}),
        description: customPrompt,
      },
    }
  } else {
    // Only the requirement can change for a tool that keeps its own prompt.
    nextProperties = properties as Record<string, unknown>
  }

  const nextRequired = requiredChanged ? [...(required ?? []), DESCRIPTION] : required
  return {
    schema: {
      ...schema,
      parameters: {
        ...parameters,
        properties: nextProperties,
        ...nextRequired !== undefined && nextRequired.length > 0 ? { required: nextRequired } : {},
      },
    },
    changed: true,
  }
}
