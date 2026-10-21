/**
 * Step Note settings section: the plugin's own page in the Settings panel.
 * It edits the `step-note` namespace through the shared configuration form
 * (the same form the Host serves for the entry) and reads the tool roster from
 * the plugin's read-only `/step-note/tools` route.
 *
 * Edits are staged locally; only Save writes the document. Tools that already
 * define a description keep their prompt unless the user opts into an
 * override. "Restore defaults" fills the draft; it never writes on its own.
 * @module @xiaoso/dsh-tool-step-note/client
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  draftFromDefaults,
  draftFromValue,
  parseToolNames,
  sameDraft,
  serializeToolNames,
  type StepNoteDefaults,
  type StepNoteDraft,
  type StepNoteValue,
} from './values.ts'

/** Registration-side face: the `step-note` entry's shared configuration form. */
export interface StepNoteSectionInjected {
  form: ConfigForm<StepNoteValue>
}

/** Props the renderer binds for the section (owner + locale + injected face). */
export type StepNoteSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'step-note'>
  & InjectFace<StepNoteSectionInjected>

/** One tool as the host route reports it. */
interface ToolInfo {
  name: string
  description: string
  strict: boolean
  mcp: boolean
  hasDescription: boolean
  overridable: boolean
  descriptionRequired: boolean
  descriptionPrompt?: string
}

/** The reserved PTC transport card. */
interface RunCodeInfo {
  known: boolean
  prompt: string
  overridable: boolean
}

/** Everything the route returns. */
interface ToolListPayload {
  tools: ToolInfo[]
  runCode: RunCodeInfo
  defaults: StepNoteDefaults
}

/** Tool-list tabs. */
type ToolTab = 'all' | 'enabled' | 'existing'

const CSS_ID = 'dsh-step-note-settings-css'

const CSS = `
.sn-section{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:2px 0 8px;max-width:760px}
.sn-pageHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.sn-pageHeadText{display:flex;flex-direction:column;gap:4px;min-width:0}
.sn-heading{margin:0;font-size:18px;font-weight:600;line-height:26px;color:var(--dsw-alias-label-primary)}
.sn-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);max-width:64ch}
.sn-card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}
.sn-cardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.sn-cardHeadText{display:flex;flex-direction:column;gap:4px;min-width:0}
.sn-cardTitle{margin:0;font-size:14px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary)}
.sn-switchRow{display:flex;align-items:flex-start;gap:10px;cursor:pointer}
.sn-switchRow input[type="checkbox"]{margin-top:3px;flex:0 0 auto}
.sn-switchText{display:flex;flex-direction:column;gap:2px;min-width:0}
.sn-switchTitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.sn-switchHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.sn-field{display:flex;flex-direction:column;gap:6px}
.sn-fieldLabel{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.sn-textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:76px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.sn-textarea:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
.sn-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.sn-warning{margin:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);font-size:12px;line-height:18px}
.sn-errorText{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.sn-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sn-search{flex:1 1 210px;min-width:160px;box-sizing:border-box;padding:6px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px}
.sn-search:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
.sn-tabs{display:flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;flex-wrap:wrap}
.sn-tab{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;padding:3px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}
.sn-tab:hover{background:var(--dsw-alias-bg-layer-2)}
.sn-tab[data-active="true"]{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}
.sn-tabCount{opacity:.7;margin-left:2px}
.sn-linkButton{appearance:none;border:none;background:none;color:var(--dsw-alias-state-business-primary);font:inherit;font-size:12px;line-height:18px;padding:2px 0;cursor:pointer}
.sn-linkButton:hover:not(:disabled){text-decoration:underline}
.sn-linkButton:disabled{opacity:.45;cursor:default}
.sn-footnote{margin-top:2px}
.sn-group{display:flex;flex-direction:column;gap:4px}
.sn-groupTitle{display:flex;align-items:center;gap:6px;margin:2px 0 0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-secondary)}
.sn-groupCount{font-weight:400;color:var(--dsw-alias-label-tertiary)}
.sn-tools{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.sn-tool{display:flex;flex-direction:column;gap:3px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.sn-tool:last-child{border-bottom:none}
.sn-tool[data-locked="true"]{opacity:.68}
.sn-toolMain{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px;line-height:20px;cursor:pointer;flex-wrap:wrap}
.sn-toolName{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.sn-badge{display:inline-flex;align-items:center;height:16px;padding:0 5px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;font-size:10px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.sn-badgeQuiet{background:transparent;color:var(--dsw-alias-label-tertiary)}
.sn-badgeMuted{background:transparent;color:var(--dsw-alias-label-tertiary);border-style:dashed}
.sn-toolDescription{margin:0 0 0 24px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sn-existing{margin:3px 0 1px 24px;padding:2px 0 2px 10px;border-left:2px solid var(--dsw-alias-border-l3);display:flex;flex-direction:column;gap:6px}
.sn-existingPrompt{display:flex;gap:6px;margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.sn-existingLabel{flex:0 0 auto;color:var(--dsw-alias-label-secondary)}
.sn-existingText{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.sn-existingActions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sn-override{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.sn-toolMeta{font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 5px}
.sn-empty{margin:0;padding:14px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);text-align:center}
.sn-errorRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sn-savebar{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 -6px 16px rgba(0,0,0,.08)}
.sn-saveState{flex:1 1 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;font-size:12px;line-height:18px}
.sn-unsaved{color:var(--dsw-alias-label-secondary)}
.sn-saved{color:var(--dsw-alias-state-business-primary)}
.sn-failure{color:var(--dsw-alias-state-error-primary)}
.sn-button{appearance:none;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:5px 12px;border-radius:7px;cursor:pointer;white-space:nowrap}
.sn-button:hover:not(:disabled){border-color:var(--dsw-alias-border-l4)}
.sn-button:disabled{opacity:.45;cursor:default}
.sn-primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}
.sn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.sn-details{font-size:12px;line-height:18px}
.sn-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.sn-originalPrompt{margin:6px 0 0;padding:6px 0 6px 10px;border-left:2px solid var(--dsw-alias-border-l3);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;overflow-wrap:anywhere}
@media (max-width:560px){
  .sn-card{padding:12px}
  .sn-tabs{width:100%}
  .sn-tab{flex:1 1 auto}
  .sn-savebar{flex-wrap:wrap}
  .sn-saveState{flex-basis:100%}
  .sn-savebar .sn-button{flex:1 1 auto}
  .sn-bulkHint{margin-left:0;flex-basis:100%}
}
`

/** Whether a value is a non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether the raw user layer names this field (presence marks an override). */
function hasUserField(user: unknown, field: string): boolean {
  return isRecord(user) && Object.prototype.hasOwnProperty.call(user, field)
}

/** Normalize a stored tool list to its sorted JSON form. */
function normalizeToolString(text: string): string {
  return serializeToolNames(parseToolNames(text))
}

/** Validate and narrow the route payload. */
function parsePayload(value: unknown): ToolListPayload | null {
  if (!isRecord(value) || !Array.isArray(value.tools) || !isRecord(value.runCode) || !isRecord(value.defaults)) return null
  const tools: ToolInfo[] = []
  for (const item of value.tools) {
    if (!isRecord(item) || typeof item.name !== 'string') return null
    tools.push({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      strict: item.strict === true,
      mcp: item.mcp === true,
      hasDescription: item.hasDescription === true,
      overridable: item.overridable === true,
      descriptionRequired: item.descriptionRequired === true,
      ...(typeof item.descriptionPrompt === 'string' ? { descriptionPrompt: item.descriptionPrompt } : {}),
    })
  }
  const runCode = value.runCode
  const defaults = value.defaults
  if (typeof runCode.prompt !== 'string' || typeof runCode.overridable !== 'boolean') return null
  if (
    typeof defaults.enabled !== 'boolean'
    || typeof defaults.required !== 'boolean'
    || typeof defaults.prompt !== 'string'
    || typeof defaults.enabledTools !== 'string'
    || typeof defaults.overrideTools !== 'string'
  ) return null
  return {
    tools,
    runCode: {
      known: runCode.known === true,
      prompt: runCode.prompt,
      overridable: runCode.overridable,
    },
    defaults: {
      enabled: defaults.enabled,
      required: defaults.required,
      prompt: defaults.prompt,
      enabledTools: defaults.enabledTools,
      overrideTools: defaults.overrideTools,
    },
  }
}

/** A strict or fixed-description tool cannot be managed by this plugin. */
function isLocked(tool: ToolInfo): boolean {
  return tool.strict || (tool.hasDescription && !tool.overridable)
}

/** Inject the section stylesheet once. */
function ensureCss(): void {
  if (document.getElementById(CSS_ID) !== null) return
  const style = document.createElement('style')
  style.id = CSS_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/**
 * Render the Step Note page.
 * @param props - slot runtime, locale, and the injected configuration form.
 * @returns the settings section.
 */
export function StepNoteSection({ form, t }: StepNoteSectionProps): ReactNode {
  const [snapshot, setSnapshot] = useState(() => form.getSnapshot())
  const [localDraft, setLocalDraft] = useState<StepNoteDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'failed' | null>(null)
  const [roster, setRoster] = useState<ToolListPayload | null>(null)
  const [loadingTools, setLoadingTools] = useState(false)
  const [toolsError, setToolsError] = useState(false)
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<ToolTab>('all')

  useEffect(ensureCss, [])

  useEffect(() => form.subscribe(() => {
    setSnapshot(form.getSnapshot())
  }), [form])

  // A successful save dismisses its bar after the confirmation has been read;
  // a failed save keeps it so the user can retry.
  useEffect(() => {
    if (notice !== 'saved') return
    const timer = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const loadTools = useCallback(async (): Promise<void> => {
    setLoadingTools(true)
    setToolsError(false)
    try {
      const response = await fetch('/step-note/tools', { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = parsePayload(await response.json())
      if (payload === null) throw new Error('invalid tool list')
      setRoster(payload)
    } catch {
      setToolsError(true)
    } finally {
      setLoadingTools(false)
    }
  }, [])

  useEffect(() => { void loadTools() }, [loadTools])

  const baseDraft = draftFromValue(snapshot.value)
  const current = localDraft ?? baseDraft
  const normalized: StepNoteDraft = { ...current, prompt: current.prompt.trim() }
  const baseNormalized: StepNoteDraft = { ...baseDraft, prompt: baseDraft.prompt.trim() }
  const dirty = localDraft !== null && !sameDraft(normalized, baseNormalized)
  const promptEmpty = normalized.prompt === ''
  const disabled = saving || !snapshot.writable
  const showSavebar = dirty || saving || notice !== null

  const enabledCount = roster === null ? 0 : roster.tools.filter(tool => current.tools.has(tool.name)).length
  const existingCount = roster === null ? 0 : roster.tools.filter(tool => tool.hasDescription).length

  const visibleTools = useMemo(() => {
    if (roster === null) return []
    const needle = filter.trim().toLowerCase()
    return roster.tools.filter((tool) => {
      if (tab === 'enabled' && !current.tools.has(tool.name)) return false
      if (tab === 'existing' && !tool.hasDescription) return false
      if (needle === '') return true
      return tool.name.toLowerCase().includes(needle)
        || tool.description.toLowerCase().includes(needle)
        || (tool.descriptionPrompt ?? '').toLowerCase().includes(needle)
    })
  }, [roster, filter, tab, current.tools])

  const enabledRows = visibleTools.filter(tool => current.tools.has(tool.name))
  const disabledRows = visibleTools.filter(tool => !current.tools.has(tool.name))

  const update = (patch: Partial<Pick<StepNoteDraft, 'enabled' | 'required' | 'prompt'>>): void => {
    setNotice(null)
    setLocalDraft(previous => ({ ...(previous ?? baseDraft), ...patch }))
  }

  const toggleTool = (name: string, checked: boolean): void => {
    setNotice(null)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const tools = new Set(draft.tools)
      const overrides = new Set(draft.overrides)
      if (checked) {
        tools.add(name)
      } else {
        tools.delete(name)
        overrides.delete(name)
      }
      return { ...draft, tools, overrides }
    })
  }

  const toggleOverride = (name: string, checked: boolean): void => {
    setNotice(null)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const overrides = new Set(draft.overrides)
      if (checked) overrides.add(name)
      else overrides.delete(name)
      return { ...draft, overrides }
    })
  }

  const reset = (): void => {
    if (roster === null || disabled) return
    setNotice(null)
    setLocalDraft(draftFromDefaults(roster.defaults))
  }

  const save = async (): Promise<void> => {
    if (disabled || localDraft === null || promptEmpty) return
    setSaving(true)
    setNotice(null)
    const defaults = roster?.defaults
    let ok = true
    const writeField = async (field: string, value: unknown, currentValue: unknown, defaultValue: unknown): Promise<void> => {
      const revert = defaultValue !== undefined
        && Object.is(value, defaultValue)
        && hasUserField(snapshot.user, field)
      if (Object.is(value, currentValue) && !revert) return
      const accepted = revert ? await form.unset(field) : await form.set(field, value)
      ok = accepted && ok
    }

    try {
      await writeField('enabled', normalized.enabled, baseNormalized.enabled, defaults?.enabled)
      await writeField('required', normalized.required, baseNormalized.required, defaults?.required)
      await writeField('prompt', normalized.prompt, baseNormalized.prompt, defaults?.prompt)
      const nextTools = serializeToolNames(normalized.tools)
      const currentTools = serializeToolNames(baseNormalized.tools)
      const defaultTools = defaults === undefined ? undefined : normalizeToolString(defaults.enabledTools)
      await writeField('enabledTools', nextTools, currentTools, defaultTools)
      const nextOverrides = serializeToolNames(normalized.overrides)
      const currentOverrides = serializeToolNames(baseNormalized.overrides)
      const defaultOverrides = defaults === undefined ? undefined : normalizeToolString(defaults.overrideTools)
      await writeField('overrideTools', nextOverrides, currentOverrides, defaultOverrides)
    } catch {
      ok = false
    }

    setSaving(false)
    if (ok) {
      setLocalDraft(null)
      setNotice('saved')
    } else {
      setNotice('failed')
    }
  }

  const renderTool = (tool: ToolInfo): ReactNode => {
    const checked = current.tools.has(tool.name)
    const overridden = current.overrides.has(tool.name)
    const locked = isLocked(tool)
    return (
      <li
        key={tool.name}
        className="sn-tool"
        data-checked={checked ? 'true' : undefined}
        data-locked={locked ? 'true' : undefined}
      >
        <label className="sn-toolMain">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled || locked}
            onChange={event => toggleTool(tool.name, event.target.checked)}
          />
          <span className="sn-toolName">{tool.name}</span>
          {tool.mcp ? <span className="sn-badge">{t('mcp')}</span> : null}
          {tool.hasDescription ? <span className="sn-badge sn-badgeQuiet">{t('hasDescription')}</span> : null}
          {tool.strict ? <span className="sn-badge sn-badgeMuted">{t('strict')}</span> : null}
          {tool.hasDescription && !tool.overridable
            ? <span className="sn-badge sn-badgeMuted">{t('fixedBadge')}</span>
            : null}
        </label>
        {tool.description === ''
          ? null
          : <p className="sn-toolDescription" title={tool.description}>{tool.description}</p>}
        {tool.hasDescription
          ? (
            <div className="sn-existing">
              <p className="sn-existingPrompt" title={tool.descriptionPrompt}>
                <span className="sn-existingLabel">{t('originalPrompt')}</span>
                <span className="sn-existingText">{tool.descriptionPrompt ?? t('noPrompt')}</span>
              </p>
              <div className="sn-existingActions">
                {tool.overridable
                  ? checked
                    ? (
                      <label className="sn-override">
                        <input
                          type="checkbox"
                          checked={overridden}
                          disabled={disabled || locked}
                          onChange={event => toggleOverride(tool.name, event.target.checked)}
                        />
                        <span>{t('override')}</span>
                      </label>
                    )
                    : <span className="sn-hint">{t('enableToOverride')}</span>
                  : <span className="sn-hint">{t('fixedHint')}</span>}
                {checked && (tool.descriptionRequired || current.required)
                  ? <span className="sn-toolMeta">{t('requiredNow')}</span>
                  : null}
              </div>
            </div>
          )
          : null}
      </li>
    )
  }

  if (snapshot.status === 'loading') {
    return (
      <div className="sn-section">
        <h2 className="sn-heading">{t('pageTitle')}</h2>
        <p className="sn-hint">{t('loading')}</p>
      </div>
    )
  }
  if (snapshot.status === 'unavailable' || snapshot.value === undefined) {
    return (
      <div className="sn-section">
        <h2 className="sn-heading">{t('pageTitle')}</h2>
        <p className="sn-hint">{t('unavailable')}</p>
      </div>
    )
  }

  return (
    <div className="sn-section">
      <div className="sn-pageHead">
        <div className="sn-pageHeadText">
          <h2 className="sn-heading">{t('pageTitle')}</h2>
          <p className="sn-intro">{t('pageDescription')}</p>
        </div>
        <button
          type="button"
          className="sn-button"
          disabled={disabled || roster === null}
          title={t('defaultsHint')}
          onClick={reset}
        >
          {t('defaults')}
        </button>
      </div>
      {snapshot.writable ? null : <p className="sn-warning">{t('readOnly')}</p>}

      <section className="sn-card">
        <div className="sn-cardHeadText">
          <h3 className="sn-cardTitle">{t('behavior')}</h3>
          <p className="sn-hint">{t('behaviorHint')}</p>
        </div>
        {current.enabled ? null : <p className="sn-warning">{t('offHint')}</p>}
        <label className="sn-switchRow">
          <input
            type="checkbox"
            checked={current.enabled}
            disabled={disabled}
            onChange={event => update({ enabled: event.target.checked })}
          />
          <span className="sn-switchText">
            <span className="sn-switchTitle">{t('master')}</span>
            <span className="sn-switchHint">{t('masterHint')}</span>
          </span>
        </label>
        <label className="sn-switchRow">
          <input
            type="checkbox"
            checked={current.required}
            disabled={disabled}
            onChange={event => update({ required: event.target.checked })}
          />
          <span className="sn-switchText">
            <span className="sn-switchTitle">{t('required')}</span>
            <span className="sn-switchHint">{t('requiredHint')}</span>
          </span>
        </label>
        <div className="sn-field">
          <label className="sn-fieldLabel" htmlFor="step-note-prompt">{t('prompt')}</label>
          <textarea
            id="step-note-prompt"
            className="sn-textarea"
            rows={4}
            value={current.prompt}
            disabled={disabled}
            onChange={event => update({ prompt: event.target.value })}
          />
          <p className={promptEmpty ? 'sn-errorText' : 'sn-hint'}>
            {promptEmpty ? t('promptEmpty') : t('promptHint')}
          </p>
        </div>
      </section>

      <section className="sn-card">
        <div className="sn-cardHead">
          <div className="sn-cardHeadText">
            <h3 className="sn-cardTitle">{t('tools')}</h3>
            <p className="sn-hint">{t('toolsHint')}</p>
          </div>
          <button
            type="button"
            className="sn-button"
            disabled={loadingTools || disabled}
            onClick={() => { void loadTools() }}
          >
            {loadingTools ? t('refreshing') : t('refresh')}
          </button>
        </div>

        {toolsError
          ? (
            <div className="sn-errorRow">
              <p className="sn-errorText">{t('loadError')}</p>
              <button type="button" className="sn-linkButton" disabled={loadingTools} onClick={() => { void loadTools() }}>
                {t('retry')}
              </button>
            </div>
          )
          : null}

        {roster === null
          ? <p className="sn-empty">{loadingTools ? t('loadingTools') : t('loadError')}</p>
          : (
            <>
              <div className="sn-toolbar">
                <input
                  className="sn-search"
                  type="search"
                  value={filter}
                  placeholder={t('filter')}
                  aria-label={t('filter')}
                  onChange={event => setFilter(event.target.value)}
                />
                <div className="sn-tabs" role="tablist" aria-label={t('tools')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'all'}
                    className="sn-tab"
                    data-active={tab === 'all'}
                    onClick={() => setTab('all')}
                  >
                    {t('tabAll')} <span className="sn-tabCount">{roster.tools.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'enabled'}
                    className="sn-tab"
                    data-active={tab === 'enabled'}
                    onClick={() => setTab('enabled')}
                  >
                    {t('tabEnabled')} <span className="sn-tabCount">{enabledCount}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'existing'}
                    className="sn-tab"
                    data-active={tab === 'existing'}
                    onClick={() => setTab('existing')}
                  >
                    {t('tabExisting')} <span className="sn-tabCount">{existingCount}</span>
                  </button>
                </div>
              </div>

              {visibleTools.length === 0
                ? <p className="sn-empty">{roster.tools.length === 0 ? t('noTools') : t('filterEmpty')}</p>
                : null}

              {enabledRows.length === 0
                ? null
                : (
                  <div className="sn-group">
                    <h4 className="sn-groupTitle">
                      {t('enabledGroup')} <span className="sn-groupCount">{enabledRows.length}</span>
                    </h4>
                    <ul className="sn-tools">{enabledRows.map(renderTool)}</ul>
                  </div>
                )}

              {disabledRows.length === 0
                ? null
                : (
                  <div className="sn-group">
                    <h4 className="sn-groupTitle">
                      {t('disabledGroup')} <span className="sn-groupCount">{disabledRows.length}</span>
                    </h4>
                    <ul className="sn-tools">{disabledRows.map(renderTool)}</ul>
                  </div>
                )}

              {roster.tools.some(tool => tool.mcp) ? <p className="sn-hint sn-footnote">{t('mcpHint')}</p> : null}
            </>
          )}
      </section>

      {roster === null
        ? null
        : (
          <section className="sn-card">
            <div className="sn-cardHead">
              <div className="sn-cardHeadText">
                <h3 className="sn-cardTitle">{t('runCodeTitle')}</h3>
                <p className="sn-hint">{t('runCodeHint')}</p>
              </div>
              <span className="sn-badge sn-badgeQuiet">{t('alwaysRequired')}</span>
            </div>
            {roster.runCode.known ? null : <p className="sn-warning">{t('runCodeFallback')}</p>}
            <details className="sn-details">
              <summary>{t('builtinPrompt')}</summary>
              <p className="sn-originalPrompt">{roster.runCode.prompt}</p>
            </details>
            {roster.runCode.overridable
              ? (
                <label className="sn-override">
                  <input
                    type="checkbox"
                    checked={current.overrides.has('run_code')}
                    disabled={disabled}
                    onChange={event => toggleOverride('run_code', event.target.checked)}
                  />
                  <span>{t('overrideRunCode')}</span>
                </label>
              )
              : <p className="sn-hint">{t('fixedHint')}</p>}
          </section>
        )}

      {showSavebar
        ? (
          <div className="sn-savebar">
            <div className="sn-saveState" aria-live="polite">
              {dirty ? <span className="sn-unsaved">{t('unsaved')}</span> : null}
              {notice === 'saved' ? <span className="sn-saved">{t('saved')}</span> : null}
              {notice === 'failed' ? <span className="sn-failure">{t('saveFailed')}</span> : null}
              {dirty && promptEmpty ? <span className="sn-failure">{t('promptEmpty')}</span> : null}
            </div>
            <button
              type="button"
              className="sn-button sn-primary"
              disabled={disabled || !dirty || promptEmpty}
              onClick={() => { void save() }}
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        )
        : null}
    </div>
  )
}
