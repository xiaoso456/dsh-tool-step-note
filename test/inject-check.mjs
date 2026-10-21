import assert from 'node:assert/strict'
import { injectDescription } from '../src/inject.ts'

const base = {
  enabled: true,
  required: false,
  prompt: 'NEW PROMPT',
  enabledTools: new Set(['edit', 'read', 'write', 'bash', 'pwsh']),
  overrideTools: new Set(),
}
const withSubagent = new Set([...base.enabledTools, 'subagent'])

// A tool without the field gains an optional argument (the new default).
{
  const schema = { name: 'read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }
  const out = injectDescription(schema, base)
  assert.equal(out.changed, true)
  assert.deepEqual(Object.keys(out.schema.parameters.properties), ['description', 'path'])
  assert.equal(out.schema.parameters.required, undefined)
}

// The required switch adds the new argument to required.
{
  const schema = { name: 'read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }
  const out = injectDescription(schema, { ...base, required: true })
  assert.deepEqual(out.schema.parameters.required, ['description'])
}

// An existing description keeps its own prompt unless the tool opts in.
{
  const schema = {
    name: 'subagent',
    description: 'delegate',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'ORIGINAL' },
        prompt: { type: 'string' },
      },
      required: ['description', 'prompt'],
    },
  }
  const out = injectDescription(schema, { ...base, enabledTools: withSubagent })
  assert.equal(out.changed, false)
  assert.equal(out.schema, schema)
}

// Required can change without touching the existing prompt.
{
  const schema = {
    name: 'subagent',
    description: 'delegate',
    parameters: {
      type: 'object',
      properties: { description: { type: 'string', description: 'ORIGINAL' }, prompt: { type: 'string' } },
      required: ['prompt'],
    },
  }
  const out = injectDescription(schema, { ...base, required: true, enabledTools: withSubagent })
  assert.equal(out.changed, true)
  assert.equal(out.schema.parameters.properties.description.description, 'ORIGINAL')
  assert.deepEqual(out.schema.parameters.required, ['prompt', 'description'])
}

// Explicit override replaces the existing prompt and preserves the field.
{
  const schema = {
    name: 'subagent',
    description: 'delegate',
    parameters: {
      type: 'object',
      properties: { description: { type: 'string', description: 'ORIGINAL' }, prompt: { type: 'string' } },
      required: ['description', 'prompt'],
    },
  }
  const before = structuredClone(schema)
  const out = injectDescription(schema, { ...base, enabledTools: withSubagent, overrideTools: new Set(['subagent']) })
  assert.equal(out.changed, true)
  assert.equal(out.schema.parameters.properties.description.description, 'NEW PROMPT')
  assert.deepEqual(Object.keys(out.schema.parameters.properties), ['description', 'prompt'])
  assert.deepEqual(schema, before, 'input schema must not be mutated')
}

// run_code is untouched by default, even though its argument is required.
{
  const schema = {
    name: 'run_code',
    description: 'run a program',
    parameters: {
      type: 'object',
      properties: { description: { type: 'string', description: 'BUILTIN' }, code: { type: 'string' } },
      required: ['description', 'code'],
    },
  }
  const out = injectDescription(schema, { ...base, required: true })
  assert.equal(out.changed, false)
  assert.equal(out.schema, schema)
}

// run_code changes only when the user opts in; it stays required.
{
  const schema = {
    name: 'run_code',
    description: 'run a program',
    parameters: {
      type: 'object',
      properties: { description: { type: 'string', description: 'BUILTIN' }, code: { type: 'string' } },
      required: ['description', 'code'],
    },
  }
  const out = injectDescription(schema, { ...base, required: false, overrideTools: new Set(['run_code']) })
  assert.equal(out.changed, true)
  assert.equal(out.schema.parameters.properties.description.description, 'NEW PROMPT')
  assert.deepEqual(out.schema.parameters.required, ['description', 'code'])
}

// A fixed (enum) description is not something the plugin can manage.
{
  const schema = {
    name: 'read',
    description: 'read',
    parameters: { type: 'object', properties: { description: { type: 'string', enum: ['a'] } } },
  }
  const out = injectDescription(schema, base)
  assert.equal(out.changed, false)
  assert.equal(out.skipped, 'shape')
}

// Strict parameters and disabled tools are skipped.
{
  const strict = { name: 'edit', description: 'edit', parameters: { type: 'object', properties: {}, additionalProperties: false } }
  assert.equal(injectDescription(strict, base).skipped, 'strict')
  const disabled = { name: 'grep', description: 'grep', parameters: { type: 'object', properties: {} } }
  assert.equal(injectDescription(disabled, base).skipped, 'not-enabled')
}

console.log('injectDescription: all assertions passed')
