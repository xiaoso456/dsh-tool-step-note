/**
 * Step Note settings section: the plugin's own page in the Settings panel.
 * It edits the `step-note` namespace through the shared configuration form
 * (the same form the Host serves for the entry) and reads the tool roster from
 * the plugin's read-only `/step-note/tools` route.
 *
 * Edits are staged locally; only Save writes the document. Every enabled tool
 * can carry its own prompt; without one it keeps its own guidance or uses the
 * global prompt. "Restore defaults" fills the draft; it never writes on its own.
 * @module @xiaoso/dsh-tool-step-note/client
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { StepNoteLocaleKey } from './locales.ts'
import { languagePrompts, type PromptLanguage } from '../prompts.ts'
import { serializeToolRequired } from '../tool-required.ts'
import {
  CARD_PRIORITY_DEFAULT,
  CARD_PRIORITY_MAX,
  CARD_PRIORITY_MIN,
  DEFAULT_TOOL_CARDS,
  clampCardPriority,
  serializeToolCards,
  type ToolCardConfig,
  type ToolCardReason,
} from '../tool-cards.ts'
import {
  draftFromDefaults,
  draftFromValue,
  parseToolNames,
  sameDraft,
  serializeToolNames,
  serializeToolPrompts,
  type StepNoteDefaults,
  type StepNoteDraft,
  type StepNoteValue,
} from './values.ts'

/** Registration-side face: the `step-note` entry's shared configuration form. */
export interface StepNoteSectionInjected {
  form: ConfigForm<StepNoteValue>
  /** Active UI language, read when the section renders. */
  uiLanguage: () => PromptLanguage
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
  cardReason: ToolCardReason
  cardPriority: number
  strict: boolean
  mcp: boolean
  hasDescription: boolean
  overridable: boolean
  descriptionRequired: boolean
  descriptionPrompt?: string
}

/** A card policy the draft carries; absent means keep the native card. */
const CARD_OFF: ToolCardConfig = { replace: false, priority: CARD_PRIORITY_DEFAULT }

/** Why a card is replaced by default, as the page explains it. */
const CARD_REASON_KEY: Record<ToolCardReason, StepNoteLocaleKey> = {
  nativeShows: 'cardReasonNativeShows',
  nativeDrops: 'cardReasonNativeDrops',
  resultCard: 'cardReasonResultCard',
  customRow: 'cardReasonCustomRow',
  generic: 'cardReasonGeneric',
  noNote: 'cardReasonNoNote',
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

/** Top-level page tabs. */
type StepNoteView = 'basic' | 'tools'

/** Tool-list filter tabs. */
type ToolTab = 'all' | 'enabled' | 'existing'

const CSS_ID = 'dsh-step-note-settings-css'

const CSS = `
.sn-section{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:2px 0 8px;max-width:760px}
.sn-section[data-savebar="true"]{padding-bottom:74px}
.sn-pageHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.sn-pageHeadText{display:flex;flex-direction:column;gap:4px;min-width:0}
.sn-heading{margin:0;font-size:18px;font-weight:600;line-height:26px;color:var(--dsw-alias-label-primary)}
.sn-heading:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:4px}
.sn-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);max-width:64ch}
/* Underline tab rail in the settings-chrome idiom: plain labels on a hairline
   rule, one brand-blue 2px underline that slides on transform only. The bar
   stays sticky and paints the settings surface so content passes underneath. */
.sn-viewBar{position:sticky;top:0;z-index:3;padding:0;background:var(--dsw-alias-bg-layer-2)}
.sn-tabs{position:relative;box-sizing:border-box;display:flex;align-items:flex-end;gap:22px;width:100%;border-bottom:1px solid var(--dsw-alias-border-l2)}
.sn-tab{position:relative;appearance:none;border:none;background:none;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);padding:7px 1px 9px;cursor:pointer;white-space:nowrap;transition:color 160ms ease}
.sn-tab:hover:not([data-active="true"]){color:var(--dsw-alias-label-primary)}
.sn-tab[data-active="true"]{color:var(--dsw-alias-label-primary)}
.sn-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:2px}
.sn-tabsIndicator{position:absolute;bottom:-1px;left:0;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-state-business-primary);pointer-events:none;transform-origin:left center;will-change:transform}
.sn-tabsCompact{gap:18px}
.sn-tabsCompact .sn-tab{padding:5px 1px 8px}
.sn-cardTitle>.sn-badge{margin-left:6px}
.sn-viewPanel{display:flex;flex-direction:column;gap:14px}
.sn-card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}
.sn-cardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.sn-cardHeadText{display:flex;flex-direction:column;gap:4px;min-width:0}
.sn-cardTitle{margin:0;font-size:14px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary)}
.sn-switchRow{display:flex;align-items:flex-start;gap:10px;cursor:pointer}
.sn-switchRow input[type="checkbox"],
.sn-toolMain input[type="checkbox"],
.sn-customPrompt input[type="checkbox"]{appearance:none;box-sizing:border-box;flex:0 0 auto;display:inline-grid;place-content:center;inline-size:16px;block-size:16px;margin:0;border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;background:transparent;cursor:pointer;transition:background-color 120ms ease,border-color 120ms ease}
.sn-switchRow input[type="checkbox"]:checked,
.sn-toolMain input[type="checkbox"]:checked,
.sn-customPrompt input[type="checkbox"]:checked{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}
.sn-switchRow input[type="checkbox"]:checked::after,
.sn-toolMain input[type="checkbox"]:checked::after,
.sn-customPrompt input[type="checkbox"]:checked::after{content:"";inline-size:3.5px;block-size:7px;border:solid var(--dsw-alias-label-primary-foreground);border-width:0 2px 2px 0;transform:rotate(45deg) translate(-.5px,-.5px)}
.sn-switchRow input[type="checkbox"]:disabled,
.sn-toolMain input[type="checkbox"]:disabled,
.sn-customPrompt input[type="checkbox"]:disabled{opacity:.5;cursor:default}
.sn-switchRow input[type="checkbox"]{margin-top:2px}
.sn-switchText{display:flex;flex-direction:column;gap:2px;min-width:0}
.sn-switchTitle{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.sn-switchHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.sn-field{display:flex;flex-direction:column;gap:6px}
.sn-fieldLabel{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.sn-select{box-sizing:border-box;max-width:280px;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.sn-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
.sn-textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:76px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.sn-textarea:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
.sn-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.sn-warning{margin:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}
.sn-errorText{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);font-weight:500}
.sn-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sn-search{flex:1 1 210px;min-width:0;box-sizing:border-box;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.sn-search:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
.sn-linkButton{appearance:none;border:none;background:none;color:var(--dsw-alias-label-primary-bluish);font:inherit;font-size:12px;line-height:18px;padding:2px 0;cursor:pointer}
.sn-linkButton:hover:not(:disabled){text-decoration:underline}
.sn-linkButton:disabled{opacity:.45;cursor:default}
.sn-footnote{margin-top:2px}
.sn-tools{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.sn-tool{position:relative;display:flex;flex-direction:column;gap:3px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.sn-tool:last-child{border-bottom:none}
.sn-tool[data-locked="true"] .sn-toolMain{cursor:default}
.sn-toolMain{display:flex;align-items:flex-start;gap:8px;min-width:0;font-size:13px;line-height:20px;cursor:pointer;margin:-4px -6px;padding:4px 6px;border-radius:6px;transition:background-color 120ms ease}
.sn-toolMain:hover,.sn-toolMain:focus-within{background:var(--dsw-alias-interactive-bg-hover)}
.sn-toolMain input[type="checkbox"]{margin:2px 0 0}
.sn-toolText{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.sn-toolHeading{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.sn-toolName{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.sn-badge{display:inline-flex;align-items:center;height:18px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;font-size:11px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.sn-badgeQuiet{background:transparent;color:var(--dsw-alias-label-secondary)}
.sn-badgeMuted{background:transparent;color:var(--dsw-alias-label-secondary);border-style:dashed}
.sn-toolDescription{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sn-toolOptions{display:flex;flex-direction:column;gap:10px;margin:6px 0 2px 22px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.sn-optionBlock{display:flex;flex-direction:column;gap:6px}
.sn-optionRule{height:1px;background:var(--dsw-alias-border-l2)}
.sn-optionChecks{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px}
.sn-optionChecks .sn-priority{margin-left:auto}
.sn-priority{display:inline-flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.sn-number{box-sizing:border-box;width:104px;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px}
.sn-number:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;border-color:transparent}
.sn-customPrompt{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer}
.sn-customPrompt input[type="checkbox"]{margin:0}
.sn-promptEditor{display:flex;flex-direction:column;gap:6px;padding-top:2px}
.sn-promptEditor .sn-textarea{min-height:66px;font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-3)}
.sn-defaultDetails{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.sn-defaultDetails summary{cursor:pointer;color:var(--dsw-alias-label-primary-bluish);width:fit-content}
.sn-defaultPrompt{margin:6px 0 0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
.sn-lockedHint{margin:2px 0 2px 22px}
.sn-toolMeta{display:inline-flex;align-items:center;height:18px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 6px;white-space:nowrap}
.sn-mark{border-radius:2px;padding:0 1px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 32%,transparent);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 26%,transparent)}
.sn-empty{margin:0;padding:14px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-align:center}
.sn-errorRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sn-savebar{box-sizing:border-box;position:sticky;bottom:10px;z-index:2;display:flex;align-items:center;gap:10px;align-self:flex-end;max-width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 6px 18px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);animation:sn-savebar-in 160ms ease-out;transition:opacity 140ms ease,transform 140ms ease}
.sn-savebar[data-closing="true"]{opacity:0;transform:translateY(6px)}
body[data-ds-dark-theme] .sn-savebar{box-shadow:0 8px 24px rgba(0,0,0,.5),0 1px 2px rgba(0,0,0,.4)}
.sn-saveState{flex:0 1 auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;font-size:12px;line-height:18px}
.sn-unsaved{color:var(--dsw-alias-label-secondary)}
.sn-saved{color:var(--dsw-alias-label-primary);font-weight:500}
.sn-failure{color:var(--dsw-alias-label-primary);font-weight:500}
.sn-button{appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:36px;border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:0 12px;border-radius:7px;cursor:pointer;white-space:nowrap;transition:border-color 120ms ease,background-color 120ms ease;/* color-only hover/press feedback (motion.md 1.2 exception) */}
.sn-button:hover:not(:disabled){border-color:var(--dsw-alias-border-l4)}
.sn-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.sn-button:disabled{opacity:.45;cursor:default}
.sn-primary{border-color:transparent;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.sn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.sn-primary:active:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.sn-button:focus-visible,.sn-linkButton:focus-visible,.sn-switchRow input[type="checkbox"]:focus-visible,.sn-toolMain input[type="checkbox"]:focus-visible,.sn-customPrompt input[type="checkbox"]:focus-visible,.sn-defaultDetails summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.sn-changed{display:inline-flex;align-items:center;height:18px;margin-left:6px;padding:0 6px;border-radius:4px;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:500;line-height:18px;white-space:nowrap;animation:sn-changed-in 120ms ease-out}
@keyframes sn-savebar-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes sn-changed-in{from{opacity:0}to{opacity:1}}
.sn-details{font-size:12px;line-height:18px}
.sn-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.sn-originalPrompt{margin:6px 0 0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
@media (max-width:640px){
  .sn-tabs{gap:16px}
}
@media (max-width:560px){
  .sn-card{padding:12px}
  .sn-section[data-savebar="true"]{padding-bottom:104px}
  .sn-savebar{width:100%;flex-wrap:wrap}
  .sn-saveState{flex-basis:100%}
  .sn-savebar .sn-button{flex:1 1 auto}
  .sn-toolOptions,.sn-lockedHint{margin-left:0}
}
@media (prefers-reduced-motion: reduce){
  .sn-savebar,.sn-button,.sn-toolMain,.sn-changed,.sn-tab{animation:none!important;transition:none!important}
  .sn-tabsIndicator{will-change:auto}
  .sn-savebar[data-closing="true"]{transform:none}
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

/** Compare two name sets without depending on insertion order. */
function sameNames(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const name of a) if (!b.has(name)) return false
  return true
}

/** Wrap the first case-insensitive match so the search term is visible. */
function highlightMatch(text: string, filter: string): ReactNode {
  const needle = filter.trim()
  if (needle === '') return text
  const index = text.toLowerCase().indexOf(needle.toLowerCase())
  if (index < 0) return text
  return (
    <>
      {text.slice(0, index)}
      <mark className="sn-mark">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  )
}

/** Validate and narrow the route payload. */
function parsePayload(value: unknown): ToolListPayload | null {
  if (!isRecord(value) || !Array.isArray(value.tools) || !isRecord(value.runCode) || !isRecord(value.defaults)) return null
  const tools: ToolInfo[] = []
  for (const item of value.tools) {
    if (!isRecord(item) || typeof item.name !== 'string') return null
    const reason = item.cardReason
    tools.push({
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      cardReason: reason === 'nativeShows' || reason === 'nativeDrops' || reason === 'resultCard'
        || reason === 'customRow' || reason === 'generic' || reason === 'noNote'
        ? reason
        : 'generic',
      cardPriority: typeof item.cardPriority === 'number' && Number.isFinite(item.cardPriority)
        ? clampCardPriority(item.cardPriority)
        : CARD_PRIORITY_DEFAULT,
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
    || (defaults.language !== 'zh' && defaults.language !== 'en')
    || typeof defaults.prompt !== 'string'
    || typeof defaults.enabledTools !== 'string'
    || typeof defaults.toolPrompts !== 'string'
    || typeof defaults.toolCards !== 'string'
    || typeof defaults.toolRequired !== 'string'
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
      language: defaults.language,
      prompt: defaults.prompt,
      enabledTools: defaults.enabledTools,
      toolPrompts: defaults.toolPrompts,
      toolCards: defaults.toolCards,
      toolRequired: defaults.toolRequired,
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



/** Compare two prompt maps after trimming, without depending on insertion order. */
function samePromptValues(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [name, value] of a) {
    if ((b.get(name) ?? '').trim() !== value.trim()) return false
  }
  return true
}

/** Trim every prompt while keeping empty entries so validation can see them. */
function trimPrompts(prompts: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const [name, value] of prompts) out.set(name, value.trim())
  return out
}

/** One tab in the section's underline tablist. */
interface UnderlineTabItem {
  value: string
  id: string
  panelId: string
  label: string
}

/**
 * Underline tablist in the settings-chrome idiom: plain labels on a hairline
 * rule and a single brand-blue 2px indicator. The indicator FLIPs on
 * transform only; geometry is re-measured through a ResizeObserver (locale or
 * font changes) and snapped without animation.
 */
function UnderlineTabs(props: {
  items: UnderlineTabItem[]
  value: string
  onChange: (value: string) => void
  label: string
  compact?: boolean
}): ReactNode {
  const { items, value, onChange, label, compact = false } = props
  const listRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const committed = useRef<{ left: number; width: number } | null>(null)

  const commit = useCallback((animate: boolean): void => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (list === null || indicator === null) return
    const index = items.findIndex(item => item.value === value)
    const tab = index < 0 ? null : tabRefs.current[index]
    if (tab === null || tab === undefined) return
    const left = tab.offsetLeft
    const width = tab.offsetWidth
    const previous = committed.current
    committed.current = { left, width }
    // Unchanged geometry → leave a mid-flight FLIP alone.
    if (previous !== null && previous.left === left && previous.width === width) return
    const reduce = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!animate || reduce || previous === null) {
      indicator.style.transition = 'none'
      indicator.style.width = `${width}px`
      indicator.style.transform = `translateX(${left}px)`
      return
    }
    indicator.style.transition = 'none'
    indicator.style.width = `${width}px`
    indicator.style.transform = `translateX(${previous.left}px) scaleX(${previous.width / width})`
    void indicator.offsetWidth
    indicator.style.transition = 'transform .24s cubic-bezier(.22,1,.36,1)'
    indicator.style.transform = `translateX(${left}px) scaleX(1)`
  }, [items, value])

  useLayoutEffect(() => { commit(true) }, [commit])

  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    const list = listRef.current
    if (list === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { commitRef.current(false) })
    observer.observe(list)
    for (const tab of tabRefs.current) if (tab !== null) observer.observe(tab)
    return () => { observer.disconnect() }
  }, [])

  return (
    <div
      ref={listRef}
      className={compact ? 'sn-tabs sn-tabsCompact' : 'sn-tabs'}
      role='tablist'
      aria-label={label}
    >
      <span ref={indicatorRef} className='sn-tabsIndicator' aria-hidden='true' />
      {items.map((item, index) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(element) => { tabRefs.current[index] = element }}
            type='button'
            role='tab'
            id={item.id}
            className='sn-tab'
            aria-selected={selected}
            aria-controls={item.panelId}
            data-active={selected ? 'true' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              let next: number
              switch (event.key) {
                case 'ArrowRight': next = (index + 1) % items.length; break
                case 'ArrowLeft': next = (index - 1 + items.length) % items.length; break
                case 'Home': next = 0; break
                case 'End': next = items.length - 1; break
                default: return
              }
              event.preventDefault()
              const target = items[next]
              if (target === undefined) return
              onChange(target.value)
              tabRefs.current[next]?.focus()
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

export function StepNoteSection({ form, t, uiLanguage }: StepNoteSectionProps): ReactNode {
  const [snapshot, setSnapshot] = useState(() => form.getSnapshot())
  const [localDraft, setLocalDraft] = useState<StepNoteDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'failed' | null>(null)
  const [roster, setRoster] = useState<ToolListPayload | null>(null)
  const [loadingTools, setLoadingTools] = useState(false)
  const [toolsError, setToolsError] = useState(false)
  const [view, setView] = useState<StepNoteView>('basic')
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<ToolTab>('all')
  const [closing, setClosing] = useState(false)
  const savebarRef = useRef<HTMLDivElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const keepFocusRef = useRef(false)

  useEffect(ensureCss, [])

  useEffect(() => form.subscribe(() => {
    setSnapshot(form.getSnapshot())
  }), [form])

  useEffect(() => {
    if (notice !== 'saved' || !keepFocusRef.current) return
    keepFocusRef.current = false
    headingRef.current?.focus({ preventScroll: true })
  }, [notice])

  useEffect(() => {
    if (notice !== 'saved') return
    let closeTimer: number | undefined
    const timer = window.setTimeout(() => {
      if (savebarRef.current?.contains(document.activeElement)) {
        headingRef.current?.focus({ preventScroll: true })
      }
      setClosing(true)
      closeTimer = window.setTimeout(() => {
        setNotice(null)
        setClosing(false)
      }, 140)
    }, 4000)
    return () => {
      window.clearTimeout(timer)
      if (closeTimer !== undefined) window.clearTimeout(closeTimer)
    }
  }, [notice])

  const loadTools = useCallback(async (): Promise<void> => {
    setLoadingTools(true)
    setToolsError(false)
    try {
      const response = await fetch('/step-note/tools', { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error('HTTP ' + response.status)
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

  const baseDraft = draftFromValue(snapshot.value, roster?.defaults)
  const current = localDraft ?? baseDraft
  const normalized: StepNoteDraft = {
    ...current,
    prompt: current.prompt.trim(),
    prompts: trimPrompts(current.prompts),
  }
  const baseNormalized: StepNoteDraft = {
    ...baseDraft,
    prompt: baseDraft.prompt.trim(),
    prompts: trimPrompts(baseDraft.prompts),
  }
  const dirty = localDraft !== null && !sameDraft(normalized, baseNormalized)
  const globalEmpty = normalized.prompt === ''
  const customEmpty = [...normalized.prompts.values()].some(value => value === '')
  const invalid = customEmpty
  const disabled = saving || !snapshot.writable
  const showSavebar = dirty || saving || notice !== null || closing
  const enabledChanged = normalized.enabled !== baseNormalized.enabled
  const requiredChanged = normalized.required !== baseNormalized.required
  const languageChanged = normalized.language !== baseNormalized.language
  const promptChanged = normalized.prompt !== baseNormalized.prompt
  const toolsChanged = !sameNames(current.tools, baseDraft.tools)
  const promptsChanged = !samePromptValues(normalized.prompts, baseNormalized.prompts)
  const cardsChanged = serializeToolCards(normalized.cards) !== serializeToolCards(baseNormalized.cards)
  const requiredToolsChanged = serializeToolRequired(normalized.requiredTools) !== serializeToolRequired(baseNormalized.requiredTools)
  const behaviorChanged = enabledChanged || requiredChanged || languageChanged || promptChanged
  const toolsCardChanged = toolsChanged || promptsChanged || cardsChanged || requiredToolsChanged
  const runCodeChanged = (normalized.prompts.get('run_code') ?? '') !== (baseNormalized.prompts.get('run_code') ?? '')
  // Which language's defaults the page shows. `auto` follows the live UI
  // language, so switching the interface language moves the defaults even
  // before the next save.
  const effectiveLanguage: PromptLanguage = normalized.language === 'auto'
    ? uiLanguage()
    : normalized.language
  const effectiveDefaults = languagePrompts(effectiveLanguage)

  const enabledCount = roster === null ? 0 : roster.tools.filter(tool => current.tools.has(tool.name)).length
  const existingCount = roster === null ? 0 : roster.tools.filter(tool => tool.hasDescription).length
  const defaultToolPrompts = effectiveDefaults.toolPrompts

  // Order by the state at the last save, not the live draft: checking a row
  // must not move it out from under the pointer. Saving re-applies the order.
  const orderedTools = useMemo(() => {
    if (roster === null) return []
    const preferred = baseDraft.tools
    return [...roster.tools].sort((a, b) => {
      const aFirst = preferred.has(a.name) ? 0 : 1
      const bFirst = preferred.has(b.name) ? 0 : 1
      return aFirst - bFirst || a.name.localeCompare(b.name)
    })
  }, [roster, baseDraft.tools])

  const visibleTools = useMemo(() => {
    if (roster === null) return []
    const needle = filter.trim().toLowerCase()
    return orderedTools.filter((tool) => {
      if (tab === 'enabled' && !current.tools.has(tool.name)) return false
      if (tab === 'existing' && !tool.hasDescription) return false
      if (needle === '') return true
      return tool.name.toLowerCase().includes(needle)
        || tool.description.toLowerCase().includes(needle)
        || (tool.descriptionPrompt ?? '').toLowerCase().includes(needle)
        || (current.prompts.get(tool.name) ?? '').toLowerCase().includes(needle)
    })
  }, [orderedTools, filter, tab, current.tools, current.prompts])

  const update = (patch: Partial<Pick<StepNoteDraft, 'enabled' | 'required' | 'language' | 'prompt'>>): void => {
    setNotice(null)
    setClosing(false)
    setLocalDraft(previous => ({ ...(previous ?? baseDraft), ...patch }))
  }

  const changeLanguage = (choice: StepNoteDraft['language']): void => {
    setNotice(null)
    setClosing(false)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const previousLanguage: PromptLanguage = draft.language === 'auto'
        ? uiLanguage()
        : draft.language
      const nextLanguage: PromptLanguage = choice === 'auto'
        ? uiLanguage()
        : choice
      if (previousLanguage === nextLanguage) return { ...draft, language: choice }
      const from = languagePrompts(previousLanguage)
      const to = languagePrompts(nextLanguage)
      // Only text the user never touched follows the language switch: a prompt
      // still equal to the old default is swapped for the new one, anything
      // else is treated as a deliberate custom prompt.
      const prompt = draft.prompt.trim() === from.prompt ? to.prompt : draft.prompt
      const prompts = new Map(draft.prompts)
      for (const [name, value] of [...prompts]) {
        const fromValue = from.toolPrompts.get(name)
        if (fromValue === undefined || value.trim() !== fromValue) continue
        const toValue = to.toolPrompts.get(name)
        if (toValue === undefined) prompts.delete(name)
        else prompts.set(name, toValue)
      }
      return { ...draft, language: choice, prompt, prompts }
    })
  }

  const toggleTool = (name: string, checked: boolean): void => {
    setNotice(null)
    setClosing(false)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const tools = new Set(draft.tools)
      const prompts = new Map(draft.prompts)
      if (checked) {
        tools.add(name)
      } else {
        tools.delete(name)
        prompts.delete(name)
      }
      return { ...draft, tools, prompts }
    })
  }

  const toggleCustomPrompt = (name: string, checked: boolean, fallback: string): void => {
    setNotice(null)
    setClosing(false)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const prompts = new Map(draft.prompts)
      if (checked) prompts.set(name, draft.prompts.get(name) ?? fallback)
      else prompts.delete(name)
      return { ...draft, prompts }
    })
  }

  const updateCustomPrompt = (name: string, value: string): void => {
    setNotice(null)
    setClosing(false)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const prompts = new Map(draft.prompts)
      prompts.set(name, value)
      return { ...draft, prompts }
    })
  }

  const toggleCard = (name: string, checked: boolean, fallbackPriority: number): void => {
    setNotice(null)
    setClosing(false)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const cards = new Map(draft.cards)
      const existing = cards.get(name) ?? { replace: false, priority: fallbackPriority }
      cards.set(name, { replace: checked, priority: existing.priority })
      return { ...draft, cards }
    })
  }

  const toggleRequired = (name: string, checked: boolean): void => {
    setNotice(null)
    setClosing(false)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const requiredTools = new Map(draft.requiredTools)
      // An explicit value equal to the global switch is not an override: drop
      // it so the tool keeps following the switch.
      if (checked === draft.required) requiredTools.delete(name)
      else requiredTools.set(name, checked)
      return { ...draft, requiredTools }
    })
  }

  const updateCardPriority = (name: string, value: number, fallbackPriority: number): void => {
    if (!Number.isFinite(value)) return
    setNotice(null)
    setClosing(false)
    setLocalDraft((previous) => {
      const draft = previous ?? baseDraft
      const cards = new Map(draft.cards)
      const existing = cards.get(name) ?? { replace: true, priority: fallbackPriority }
      cards.set(name, { replace: existing.replace, priority: clampCardPriority(value) })
      return { ...draft, cards }
    })
  }

  const reset = (): void => {
    if (roster === null || disabled) return
    setNotice(null)
    setClosing(false)
    // The language default is `auto`; pinning the resolved language would stop
    // the defaults from following the UI later.
    setLocalDraft({ ...draftFromDefaults(roster.defaults), language: 'auto' })
  }

  const discard = (): void => {
    if (disabled) return
    const focusInBar = savebarRef.current?.contains(document.activeElement) === true
    setLocalDraft(null)
    setNotice(null)
    setClosing(false)
    if (focusInBar) headingRef.current?.focus({ preventScroll: true })
  }

  const save = async (): Promise<void> => {
    if (disabled || localDraft === null || invalid) return
    keepFocusRef.current = savebarRef.current?.contains(document.activeElement) === true
    setSaving(true)
    setNotice(null)
    setClosing(false)
    const defaults = roster?.defaults
    const defaultPrompt = effectiveDefaults.prompt
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
      await writeField('language', normalized.language, baseNormalized.language, 'auto')
      // Saving the default text as an empty value keeps the prompt following
      // the selected language instead of pinning today's translation.
      const storedPrompt = snapshot.value?.prompt ?? ''
      const nextPrompt = normalized.prompt === '' || normalized.prompt === defaultPrompt ? '' : normalized.prompt
      await writeField('prompt', nextPrompt, storedPrompt, '')
      const nextTools = serializeToolNames(normalized.tools)
      const currentTools = serializeToolNames(baseNormalized.tools)
      const defaultTools = defaults === undefined ? undefined : normalizeToolString(defaults.enabledTools)
      await writeField('enabledTools', nextTools, currentTools, defaultTools)
      // Unchanged defaults stay blank so they keep following the language; an
      // edited or disabled default is written explicitly.
      const nextPrompts = serializeToolPrompts(normalized.prompts)
      const savePrompts = nextPrompts === serializeToolPrompts(defaultToolPrompts) ? '' : nextPrompts
      await writeField('toolPrompts', savePrompts, snapshot.value?.toolPrompts ?? '', '')
      const nextCards = serializeToolCards(normalized.cards)
      const defaultCards = serializeToolCards(DEFAULT_TOOL_CARDS)
      const saveCards = nextCards === defaultCards ? '' : nextCards
      await writeField('toolCards', saveCards, snapshot.value?.toolCards ?? '', '')
      const nextRequiredTools = normalized.requiredTools.size === 0 ? '' : serializeToolRequired(normalized.requiredTools)
      await writeField('toolRequired', nextRequiredTools, snapshot.value?.toolRequired ?? '', '')
    } catch {
      ok = false
    }

    setSaving(false)
    if (ok) {
      setLocalDraft(null)
      setNotice('saved')
      // The route's defaults belong to the language just saved; refresh the
      // roster so the fallback texts and the run_code preview follow it.
      void loadTools()
    } else {
      setNotice('failed')
    }
  }

  const renderTool = (tool: ToolInfo): ReactNode => {
    const checked = current.tools.has(tool.name)
    const customValue = current.prompts.get(tool.name)
    const customChecked = customValue !== undefined
    const defaultPrompt = defaultToolPrompts.get(tool.name)
    const usingDefault = customChecked && defaultPrompt !== undefined && (customValue ?? '') === defaultPrompt
    const locked = isLocked(tool)
    const fallback = tool.descriptionPrompt ?? defaultToolPrompts.get(tool.name) ?? normalized.prompt
    const card = current.cards.get(tool.name) ?? CARD_OFF
    const baseCard = baseDraft.cards.get(tool.name) ?? CARD_OFF
    const cardChanged = card.replace !== baseCard.replace
      || (card.replace && card.priority !== baseCard.priority)
    const requiredEffective = current.requiredTools.get(tool.name) ?? current.required
    const requiredHereChanged = current.requiredTools.has(tool.name) !== baseDraft.requiredTools.has(tool.name)
      || current.requiredTools.get(tool.name) !== baseDraft.requiredTools.get(tool.name)
    const changed = checked !== baseDraft.tools.has(tool.name)
      || (customValue ?? '').trim() !== (baseDraft.prompts.get(tool.name) ?? '').trim()
      || cardChanged
      || requiredHereChanged
    const promptId = 'step-note-tool-prompt-' + tool.name
    const cardId = 'step-note-tool-card-priority-' + tool.name
    const main = (
      <label className='sn-toolMain'>
        <input
          type='checkbox'
          checked={checked}
          disabled={disabled || locked}
          onChange={event => toggleTool(tool.name, event.target.checked)}
        />
        <span className='sn-toolText'>
          <span className='sn-toolHeading'>
            <span className='sn-toolName'>{highlightMatch(tool.name, filter)}</span>
            {tool.mcp ? <span className='sn-badge'>{t('mcp')}</span> : null}
            {tool.hasDescription ? <span className='sn-badge sn-badgeQuiet'>{t('hasDescription')}</span> : null}
            {tool.strict ? <span className='sn-badge sn-badgeMuted'>{t('strict')}</span> : null}
            {tool.hasDescription && !tool.overridable
              ? <span className='sn-badge sn-badgeMuted'>{t('fixedBadge')}</span>
              : null}
            {changed ? <span className='sn-changed'>{t('changed')}</span> : null}
          </span>
          {tool.description === ''
            ? null
            : <span className='sn-toolDescription'>{highlightMatch(tool.description, filter)}</span>}
        </span>
      </label>
    )
    return (
      <li
        key={tool.name}
        className='sn-tool'
        data-checked={checked ? 'true' : undefined}
        data-locked={locked ? 'true' : undefined}
      >
        {tool.description === ''
          ? main
          : (
            <Tooltip
              label={tool.description}
              side='bottom'
              delayMs={500}
              maxWidth={420}
              portal
            >
              {main}
            </Tooltip>
          )}
        {checked && !locked
          ? (
            <div className='sn-toolOptions'>
              <div className='sn-optionBlock'>
                <label className='sn-customPrompt'>
                  <input
                    type='checkbox'
                    checked={customChecked}
                    disabled={disabled}
                    onChange={event => toggleCustomPrompt(tool.name, event.target.checked, fallback)}
                    aria-controls={customChecked ? promptId : undefined}
                    aria-expanded={customChecked}
                  />
                  <span>{t('customPrompt')}</span>
                </label>
                {customChecked
                  ? (
                    <div className='sn-promptEditor' id={promptId}>
                      <p className='sn-hint'>{usingDefault ? t('customDefaultOn') : (tool.hasDescription ? t('customOnOwn') : t('customOnGlobal'))}</p>
                      <textarea
                        className='sn-textarea'
                        rows={3}
                        value={customValue ?? ''}
                        disabled={disabled}
                        aria-label={t('customPrompt')}
                        onChange={event => updateCustomPrompt(tool.name, event.target.value)}
                      />
                      {(customValue ?? '').trim() === ''
                        ? <p className='sn-errorText'>{t('customEmpty')}</p>
                        : null}
                    </div>
                  )
                  : (
                    <>
                      <p className='sn-hint'>{tool.hasDescription ? t('customOffOwn') : t('customOffGlobal')}</p>
                      {tool.hasDescription && tool.descriptionPrompt !== undefined
                        ? (
                          <details className='sn-defaultDetails'>
                            <summary>{t('viewOwnPrompt')}</summary>
                            <p className='sn-defaultPrompt'>{highlightMatch(tool.descriptionPrompt, filter)}</p>
                          </details>
                        )
                        : null}
                    </>
                  )}
              </div>
              <div className='sn-optionRule' />
              <div className='sn-optionBlock'>
                <div className='sn-optionChecks'>
                  <label className='sn-customPrompt' title={t('requiredToolHint')}>
                    <input
                      type='checkbox'
                      checked={requiredEffective}
                      disabled={disabled}
                      onChange={event => toggleRequired(tool.name, event.target.checked)}
                    />
                    <span>{t('requiredShort')}</span>
                  </label>
                  <label className='sn-customPrompt'>
                    <input
                      type='checkbox'
                      checked={card.replace}
                      disabled={disabled}
                      onChange={event => toggleCard(tool.name, event.target.checked, tool.cardPriority)}
                      aria-controls={card.replace ? cardId : undefined}
                      aria-expanded={card.replace}
                    />
                    <span>{t('cardReplace')}</span>
                  </label>
                  {card.replace
                    ? (
                      <label className='sn-priority' htmlFor={cardId}>
                        <span>{t('cardPriority')}</span>
                        <input
                          id={cardId}
                          className='sn-number'
                          type='number'
                          inputMode='numeric'
                          step={1}
                          min={CARD_PRIORITY_MIN}
                          max={CARD_PRIORITY_MAX}
                          value={card.priority}
                          disabled={disabled}
                          onChange={event => updateCardPriority(tool.name, Number(event.target.value), tool.cardPriority)}
                        />
                      </label>
                    )
                    : null}
                </div>
                <p className='sn-hint'>{t(CARD_REASON_KEY[tool.cardReason])}</p>
                {card.replace ? <p className='sn-hint'>{t('cardReplaceHint')}</p> : null}
              </div>
            </div>
          )
          : null}
        {locked && tool.hasDescription
          ? <p className='sn-hint sn-lockedHint'>{t('fixedHint')}</p>
          : null}
      </li>
    )
  }

  const renderRunCode = (): ReactNode => {
    if (roster === null) return null
    const customValue = current.prompts.get('run_code')
    const customChecked = customValue !== undefined
    const defaultPrompt = defaultToolPrompts.get('run_code')
    const usingDefault = customChecked && defaultPrompt !== undefined && (customValue ?? '') === defaultPrompt
    const promptId = 'step-note-run-code-prompt'
    return (
      <section className='sn-card'>
        <div className='sn-cardHead'>
          <div className='sn-cardHeadText'>
            <h3 className='sn-cardTitle'>
              {t('runCodeTitle')}
              {runCodeChanged ? <span className='sn-changed'>{t('changed')}</span> : null}
            </h3>
            <p className='sn-hint'>{t('runCodeHint')}</p>
          </div>
          <span className='sn-badge sn-badgeQuiet'>{t('alwaysRequired')}</span>
        </div>
        {roster.runCode.known ? null : <p className='sn-warning'>{t('runCodeFallback')}</p>}
        <details className='sn-details'>
          <summary>{t('builtinPrompt')}</summary>
          <p className='sn-originalPrompt'>{roster.runCode.prompt}</p>
        </details>
        {roster.runCode.overridable
          ? (
            <>
              <label className='sn-customPrompt'>
                <input
                  type='checkbox'
                  checked={customChecked}
                  disabled={disabled}
                  onChange={event => toggleCustomPrompt('run_code', event.target.checked, roster.runCode.prompt)}
                  aria-controls={customChecked ? promptId : undefined}
                  aria-expanded={customChecked}
                />
                <span>{t('customPrompt')}</span>
              </label>
              {customChecked
                ? (
                  <div className='sn-promptEditor' id={promptId}>
                    <p className='sn-hint'>{usingDefault ? t('runCodeDefaultOn') : t('runCodeCustomOn')}</p>
                    <textarea
                      className='sn-textarea'
                      rows={3}
                      value={customValue ?? ''}
                      disabled={disabled}
                      aria-label={t('customPrompt')}
                      onChange={event => updateCustomPrompt('run_code', event.target.value)}
                    />
                    {(customValue ?? '').trim() === ''
                      ? <p className='sn-errorText'>{t('customEmpty')}</p>
                      : null}
                  </div>
                )
                : <p className='sn-hint'>{t('runCodeCustomOff')}</p>}
            </>
          )
          : <p className='sn-hint'>{t('fixedHint')}</p>}
      </section>
    )
  }

  if (snapshot.status === 'loading') {
    return (
      <div className='sn-section'>
        <h2 className='sn-heading'>{t('pageTitle')}</h2>
        <p className='sn-hint'>{t('loading')}</p>
      </div>
    )
  }
  if (snapshot.status === 'unavailable' || snapshot.value === undefined) {
    return (
      <div className='sn-section'>
        <h2 className='sn-heading'>{t('pageTitle')}</h2>
        <p className='sn-hint'>{t('unavailable')}</p>
      </div>
    )
  }

  return (
    <div className='sn-section' data-savebar={showSavebar ? 'true' : undefined}>
      <div className='sn-pageHead'>
        <div className='sn-pageHeadText'>
          <h2 className='sn-heading' ref={headingRef} tabIndex={-1}>{t('pageTitle')}</h2>
          <p className='sn-intro'>{t('pageDescription')}</p>
        </div>
        <Tooltip label={t('defaultsHint')} side='bottom' delayMs={400} maxWidth={320} portal>
          <button
            type='button'
            className='sn-button'
            disabled={disabled || roster === null}
            onClick={reset}
          >
            {t('defaults')}
          </button>
        </Tooltip>
      </div>
      {snapshot.writable ? null : <p className='sn-warning'>{t('readOnly')}</p>}

      <div className='sn-viewBar'>
        <UnderlineTabs
          items={[
            {
              value: 'basic',
              id: 'step-note-view-basic',
              panelId: 'step-note-view-basic-panel',
              label: t('viewBasic'),
            },
            {
              value: 'tools',
              id: 'step-note-view-tools',
              panelId: 'step-note-view-tools-panel',
              label: t('viewTools'),
            },
          ]}
          value={view}
          onChange={value => setView(value as StepNoteView)}
          label={t('pageTitle')}
        />
      </div>

      {view === 'basic'
        ? (
          <div
            className='sn-viewPanel'
            id='step-note-view-basic-panel'
            role='tabpanel'
            aria-labelledby='step-note-view-basic'
          >
            <section className='sn-card'>
              <div className='sn-cardHeadText'>
                <h3 className='sn-cardTitle'>
                  {t('behavior')}
                  {current.enabled ? null : <span className='sn-badge sn-badgeMuted'>{t('masterOff')}</span>}
                  {behaviorChanged ? <span className='sn-changed'>{t('changed')}</span> : null}
                </h3>
                <p className='sn-hint'>{t('behaviorHint')}</p>
              </div>
              <label className='sn-switchRow'>
                <input
                  type='checkbox'
                  checked={current.enabled}
                  disabled={disabled}
                  onChange={event => update({ enabled: event.target.checked })}
                />
                <span className='sn-switchText'>
                  <span className='sn-switchTitle'>{t('master')}</span>
                  <span className='sn-switchHint'>{t('masterHint')}</span>
                </span>
              </label>
              <label className='sn-switchRow'>
                <input
                  type='checkbox'
                  checked={current.required}
                  disabled={disabled}
                  onChange={event => update({ required: event.target.checked })}
                />
                <span className='sn-switchText'>
                  <span className='sn-switchTitle'>{t('required')}</span>
                  <span className='sn-switchHint'>{t('requiredHint')}</span>
                </span>
              </label>
              <div className='sn-field'>
                <label className='sn-fieldLabel' htmlFor='step-note-language'>{t('language')}</label>
                <select
                  id='step-note-language'
                  className='sn-select'
                  value={current.language}
                  disabled={disabled}
                  onChange={event => changeLanguage(event.target.value as StepNoteDraft['language'])}
                >
                  <option value='auto'>{t('languageAuto')}</option>
                  <option value='zh'>{t('languageZh')}</option>
                  <option value='en'>{t('languageEn')}</option>
                </select>
                <p className='sn-hint'>{t('languageHint')}</p>
              </div>
              <div className='sn-field'>
                <label className='sn-fieldLabel' htmlFor='step-note-prompt'>{t('prompt')}</label>
                <textarea
                  id='step-note-prompt'
                  className='sn-textarea'
                  rows={4}
                  value={current.prompt}
                  disabled={disabled}
                  onChange={event => update({ prompt: event.target.value })}
                />
                <p className='sn-hint'>{globalEmpty ? t('promptEmptyHint') : t('promptHint')}</p>
              </div>
            </section>
          </div>
        )
        : (
          <div
            className='sn-viewPanel'
            id='step-note-view-tools-panel'
            role='tabpanel'
            aria-labelledby='step-note-view-tools'
          >
            <section className='sn-card'>
              <div className='sn-cardHead'>
                <div className='sn-cardHeadText'>
                  <h3 className='sn-cardTitle'>
                    {t('tools')}
                    {toolsCardChanged ? <span className='sn-changed'>{t('changed')}</span> : null}
                  </h3>
                  <p className='sn-hint'>{t('toolsHint')}</p>
                </div>
                <button
                  type='button'
                  className='sn-button'
                  disabled={loadingTools || disabled}
                  onClick={() => { void loadTools() }}
                >
                  {loadingTools ? t('refreshing') : t('refresh')}
                </button>
              </div>

              {toolsError
                ? (
                  <div className='sn-errorRow'>
                    <p className='sn-errorText'>{t('loadError')}</p>
                    <button type='button' className='sn-linkButton' disabled={loadingTools} onClick={() => { void loadTools() }}>
                      {t('retry')}
                    </button>
                  </div>
                )
                : null}

              {roster === null
                ? <p className='sn-empty'>{loadingTools ? t('loadingTools') : t('loadError')}</p>
                : (
                  <>
                    <div className='sn-toolbar'>
                      <input
                        className='sn-search'
                        type='search'
                        value={filter}
                        placeholder={t('filter')}
                        aria-label={t('filter')}
                        onChange={event => setFilter(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Escape' || filter === '') return
                          event.preventDefault()
                          event.stopPropagation()
                          setFilter('')
                        }}
                      />
                      <UnderlineTabs
                        compact
                        items={[
                          { value: 'all', id: 'step-note-tools-all', panelId: 'step-note-tools-all-panel', label: t('tabAll') + ' ' + roster.tools.length },
                          { value: 'enabled', id: 'step-note-tools-enabled', panelId: 'step-note-tools-enabled-panel', label: t('tabEnabled') + ' ' + enabledCount },
                          { value: 'existing', id: 'step-note-tools-existing', panelId: 'step-note-tools-existing-panel', label: t('tabExisting') + ' ' + existingCount },
                        ]}
                        value={tab}
                        onChange={value => setTab(value as ToolTab)}
                        label={t('tools')}
                      />
                    </div>

                    <div
                      id={'step-note-tools-' + tab + '-panel'}
                      role='tabpanel'
                      aria-labelledby={'step-note-tools-' + tab}
                    >
                      {roster.tools.some(tool => tool.mcp || tool.hasDescription || tool.strict)
                        ? <p className='sn-hint sn-footnote'>{t('badgeLegend')}</p>
                        : null}

                      {visibleTools.length === 0
                        ? <p className='sn-empty'>{roster.tools.length === 0 ? t('noTools') : t('filterEmpty')}</p>
                        : <ul className='sn-tools' aria-label={t('tools')}>{visibleTools.map(renderTool)}</ul>}
                    </div>
                  </>
                )}
            </section>
            {renderRunCode()}
          </div>
        )}

      {showSavebar
        ? (
          <div
            className='sn-savebar'
            ref={savebarRef}
            data-closing={closing ? 'true' : undefined}
          >
            <div className='sn-saveState' aria-live='polite'>
              {dirty ? <span className='sn-unsaved'>{t('unsaved')}</span> : null}
              {notice === 'saved' ? <span className='sn-saved'>{t('saved')}</span> : null}
              {notice === 'failed' ? <span className='sn-failure'>{t('saveFailed')}</span> : null}
              {dirty && invalid
                ? <span className='sn-failure'>{t('customEmpty')}</span>
                : null}
            </div>
            {dirty
              ? (
                <button
                  type='button'
                  className='sn-button'
                  disabled={disabled}
                  onClick={discard}
                >
                  {t('discard')}
                </button>
              )
              : null}
            <button
              type='button'
              className='sn-button sn-primary'
              disabled={disabled || !dirty || invalid}
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
