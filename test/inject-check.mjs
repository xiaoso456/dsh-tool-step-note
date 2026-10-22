import assert from 'node:assert/strict'
import { resolveConfig, resolveLanguage } from '../src/config.ts'
import { injectDescription } from '../src/inject.ts'

const base = {
  enabled: true,
  required: false,
  prompt: 'NEW PROMPT',
  enabledTools: new Set(['edit', 'read', 'write', 'bash', 'pwsh']),
  toolPrompts: new Map(),
  toolRequired: new Map(),
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

// A per-tool prompt is used when the tool has no description of its own.
{
  const schema = { name: 'read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }
  const out = injectDescription(schema, { ...base, toolPrompts: new Map([['read', 'TOOL PROMPT']]) })
  assert.equal(out.changed, true)
  assert.equal(out.schema.parameters.properties.description.description, 'TOOL PROMPT')
}

// Empty per-tool prompts are ignored by the host parser, so the global prompt applies.
{
  const schema = { name: 'read', description: 'read a file', parameters: { type: 'object', properties: {} } }
  const out = injectDescription(schema, base)
  assert.equal(out.schema.parameters.properties.description.description, 'NEW PROMPT')
}

// A per-tool override wins over the global required switch.
{
  const schema = { name: 'read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }
  const on = injectDescription(schema, { ...base, required: false, toolRequired: new Map([['read', true]]) })
  assert.deepEqual(on.schema.parameters.required, ['description'])
  const off = injectDescription(schema, { ...base, required: true, toolRequired: new Map([['read', false]]) })
  assert.equal(off.schema.parameters.required, undefined)
}

// The required switch adds the new argument to required.
{
  const schema = { name: 'read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }
  const out = injectDescription(schema, { ...base, required: true })
  assert.deepEqual(out.schema.parameters.required, ['description'])
}

// An existing description keeps its own prompt unless the tool is named.
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
  const out = injectDescription(schema, {
    ...base,
    enabledTools: withSubagent,
    toolPrompts: new Map([['subagent', 'TOOL PROMPT']]),
  })
  assert.equal(out.changed, true)
  assert.equal(out.schema.parameters.properties.description.description, 'TOOL PROMPT')
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
  const out = injectDescription(schema, {
    ...base,
    required: false,
    toolPrompts: new Map([['run_code', 'TOOL PROMPT']]),
  })
  assert.equal(out.changed, true)
  assert.equal(out.schema.parameters.properties.description.description, 'TOOL PROMPT')
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

// Language defaults: `auto` follows the UI locale; a blank prompt/toolPrompts
// document uses that language's defaults, while an explicit document wins.
{
  assert.equal(resolveLanguage('auto', 'en-US'), 'en')
  assert.equal(resolveLanguage('auto', 'zh-CN'), 'zh')
  assert.equal(resolveLanguage('auto', undefined), 'zh')
  assert.equal(resolveLanguage('zh', 'en'), 'zh')

  const zh = resolveConfig({ enabled: true, required: false, language: 'auto', prompt: '', toolPrompts: '', toolCards: '' }, 'zh')
  assert.match(zh.prompt, /用中文一句话描述/u)
  assert.equal(zh.toolPrompts.get('bash')?.includes('用中文'), true)
  assert.equal(zh.toolPrompts.has('run_code'), true)
  assert.deepEqual([...zh.cards.keys()].sort(), ['edit', 'read', 'write'])
  assert.deepEqual([...zh.enabledTools].sort(), ['bash', 'edit', 'glob', 'grep', 'job_kill', 'job_list', 'job_output', 'pwsh', 'read', 'write'])
  assert.equal(zh.toolRequired.size, 0)

  const en = resolveConfig({ enabled: true, required: false, language: 'auto', prompt: '', toolPrompts: '', toolCards: '' }, 'en')
  assert.match(en.prompt, /One short sentence/u)
  assert.equal(en.toolPrompts.size, 0)
  assert.deepEqual([...en.cards.keys()].sort(), ['edit', 'read', 'write'])
  assert.deepEqual([...en.enabledTools].sort(), ['bash', 'edit', 'glob', 'grep', 'job_kill', 'job_list', 'job_output', 'pwsh', 'read', 'write'])

  const custom = resolveConfig({ prompt: 'CUSTOM', toolPrompts: '{"read":"R"}', toolCards: '{}' }, 'en')
  assert.equal(custom.prompt, 'CUSTOM')
  assert.equal(custom.toolPrompts.get('read'), 'R')
  assert.equal(custom.cards.size, 0)
}

console.log('language defaults: all assertions passed')
