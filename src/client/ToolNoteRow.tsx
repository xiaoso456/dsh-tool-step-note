/**
 * Tool-card note layer: replaces the built-in row of each tool the user opted
 * in for, so the note stays on the settled card instead of only flashing by on
 * the running step line.
 *
 * The built-in views cannot be extended, only replaced: the keyed
 * tool.call.toolview slot lets a later registration shadow an occupied key,
 * and "lowest priority renders". Each tool carries its own priority (below the
 * shipped zero) and its own switch; the browser half re-registers whenever the
 * map changes so a disabled tool gets its native card back.
 *
 * The body keeps the primitive DiffBlock for edit/write (the diff is derivable
 * from the arguments) and falls back to a plain preformatted pane for the
 * read/job result text. Rich built-in previews (line-numbered read view,
 * structured job receipts) are not reproduced; the file path stays clickable.
 * @module @xiaoso/dsh-tool-step-note/client
 */

import { useMemo, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  DiffBlock,
  DisclosureRow,
  IconBrowseOutlineRegular,
  IconChecklistOutlineRegular,
  IconCloseOutlineRegular,
  IconEditOutlineRegular,
  IconInspectOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './namespace.ts'
import type { ToolCardConfig } from '../tool-cards.ts'

/** Lazy argument view of one tool call (the framework's ToolArgs surface). */
interface ArgsView {
  has(key: string): boolean
  complete(key: string): boolean
  text(key: string): string | undefined
  value(key: string): unknown
}

/** One text block of a settled result. */
interface ResultBlock {
  type: string
  text?: string
}

/** The call slice the row reads; shape-compatible with ToolCallBlock. */
interface ToolBlockView {
  readonly kind?: string
  readonly phase?: 'preparing' | 'start'
  readonly args: ArgsView
  readonly content?: readonly ResultBlock[]
  readonly isError?: boolean
  readonly error?: { name: string; code: string }
  readonly meta?: unknown
}

/** The keyed tool-view slot declared by the DSH Tool package. */
const TOOLVIEW_SLOT = 'tool.call.toolview'

/**
 * Owner props of the slot as this row consumes them. The full contract is
 * declared by @deepseek-ai/dsh-client-ui-tool, which this plugin deliberately
 * does not depend on; reading the structural subset keeps the package free of
 * a client dependency while the registry still checks the real entry.
 */
interface ToolNoteOwnerProps {
  useDisclosure(): { expanded: boolean; toggle: () => void }
  callId: string
  toolName: string
  cwd?: string | undefined
  home?: string | undefined
  openFile: (path: string, options?: { line?: number }) => void
  block: ToolBlockView
}

/** Structural slice of the slot registry used here (avoids a duplicate SlotMap merge). */
interface SlotRegistrySlice {
  inject(name: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** Full row props: the owner share plus this plugin's dictionary. */
type ToolNoteRowProps = ToolNoteOwnerProps & PropsLocale<'step-note'>

const CSS_ID = 'dsh-step-note-tool-row-css'

/** Row styles; injected when the layer first registers. */
const CSS = ".snr-summary{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}\n.snr-summaryLink{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0;padding:0;border:none;background:none;font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:inherit;text-align:left;text-decoration:underline dotted;text-decoration-thickness:1px;text-underline-offset:3px;cursor:pointer}\n.snr-summaryLink:hover{color:var(--dsw-alias-label-primary)}\n.snr-sep{flex:none;width:2px;height:2px;border-radius:1px;margin:0 8px;background:var(--dsw-alias-label-caption)}\n.snr-error{color:var(--dsw-alias-state-error-primary)}\n.snr-body{display:flex;flex-direction:column;margin:4px 0 4px 4px}\n.snr-pre{box-sizing:border-box;max-height:260px;overflow:auto;margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}\n.snr-pre[data-error]{color:var(--dsw-alias-state-error-primary)}\n.snr-diff{max-height:320px;overflow:auto}"

/** Inject the row stylesheet once. */
function ensureCss(): void {
  if (document.getElementById(CSS_ID) !== null) return
  const style = document.createElement('style')
  style.id = CSS_ID
  style.textContent = CSS
  document.head.append(style)
}

/** Localized title key per tool. */
const TITLE_KEYS = {
  read: 'rowRead',
  write: 'rowWrite',
  edit: 'rowEdit',
  job_list: 'rowJobList',
  job_output: 'rowJobOutput',
  job_kill: 'rowJobKill',
} as const

/** Leading glyph per tool. */
function iconOf(tool: string): ReactNode {
  if (tool === 'read') return <IconBrowseOutlineRegular size={14} />
  if (tool === 'write' || tool === 'edit') return <IconEditOutlineRegular size={14} />
  if (tool === 'job_list') return <IconChecklistOutlineRegular size={14} />
  if (tool === 'job_output') return <IconInspectOutlineRegular size={14} />
  if (tool === 'job_kill') return <IconCloseOutlineRegular size={14} />
  return <IconInspectOutlineRegular size={14} />
}

/** Text of a complete argument, or undefined while the view still grows. */
function completeText(args: ArgsView, key: string): string | undefined {
  if (!args.has(key) || !args.complete(key)) return undefined
  const text = args.text(key)
  return text === undefined || text === '' ? undefined : text
}

/** Display a path relative to the session workspace, or home-relative. */
function displayPath(path: string, cwd?: string, home?: string): string {
  const normalized = path.replace(/\\/g, '/')
  const base = cwd?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (base !== undefined && base !== '' && (normalized === base || normalized.startsWith(base + '/'))) {
    return normalized.slice(base.length).replace(/^\/+/, '')
  }
  const homeBase = home?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (homeBase !== undefined && homeBase !== '' && normalized.startsWith(homeBase + '/')) {
    return '~' + normalized.slice(homeBase.length)
  }
  return path
}

/** Read a 1-based line argument, when the model supplied one. */
function lineArg(args: ArgsView): number | undefined {
  const value = args.value('offset')
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

/** Flatten the settled result's text blocks. */
function resultText(block: ToolBlockView): string | null {
  const parts: string[] = []
  for (const part of block.content ?? []) {
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text)
  }
  if (parts.length === 0 && block.error !== undefined) parts.push(block.error.name + ': ' + block.error.code)
  return parts.length === 0 ? null : parts.join('\n')
}

/** The read tool wraps its content in an envelope; show the file body alone. */
function readBody(text: string): string {
  const match = /<content>\n([\s\S]*)\n<\/content>$/u.exec(text)
  return match?.[1] ?? text
}

/** Validate applied result metadata hunks. */
function appliedDiffs(meta: unknown): DiffHunk[] | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const out: DiffHunk[] = []
  for (const hunk of diffs) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText } = hunk as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    out.push({ path, oldText, newText })
  }
  return out
}

/** The diff body for edit/write: applied metadata first, arguments otherwise. */
function diffBody(block: ToolBlockView, toolName: string): DiffHunk[] {
  const applied = appliedDiffs(block.meta)
  if (applied !== null) return applied
  const path = completeText(block.args, 'file_path') ?? completeText(block.args, 'path')
  if (path === undefined) return []
  if (toolName === 'write') {
    const content = completeText(block.args, 'content')
    return content === undefined ? [] : [{ path, oldText: null, newText: content }]
  }
  if (toolName === 'edit') {
    const oldText = completeText(block.args, 'old_string')
    const newText = completeText(block.args, 'new_string')
    return oldText === undefined || newText === undefined
      ? []
      : [{ path, oldText: oldText === '' ? null : oldText, newText }]
  }
  return []
}

/** One tool card: the model-written note, the path, and the result body. */
function ToolNoteRow({
  block,
  toolName,
  cwd,
  home,
  openFile,
  useDisclosure,
  t,
}: ToolNoteRowProps): ReactNode {
  const { expanded, toggle } = useDisclosure()
  const settled = block.kind === 'tool-result'
  const preparing = !settled && block.phase === 'preparing'
  const interrupted = settled && block.error?.code === 'interrupted'
  const failed = settled && block.isError === true && !interrupted
  const description = block.args.text('description')?.trim() ?? ''
  const rawPath = completeText(block.args, 'file_path') ?? completeText(block.args, 'path')
  const jobId = completeText(block.args, 'job_id')
  const path = rawPath === undefined ? undefined : displayPath(rawPath, cwd, home)
  const summary = description !== '' ? description : path ?? jobId ?? toolName
  const note = path === undefined || description === '' ? summary : description + ' · ' + path
  const diffs = useMemo(
    () => toolName === 'edit' || toolName === 'write' ? diffBody(block, toolName) : [],
    [block, toolName],
  )
  const output = useMemo(() => {
    if (!settled) return null
    const text = resultText(block)
    if (text === null) return null
    return toolName === 'read' ? readBody(text) : text
  }, [block, settled, toolName])
  const expandable = !preparing && (diffs.length > 0 || output !== null)
  const labels = useMemo(() => ({
    codeLabel: t('rowCode'),
    wrapLabel: t('rowWrap'),
    unwrapLabel: t('rowUnwrap'),
    copy: t('rowCopy'),
    copied: t('rowCopied'),
    collapseAria: t('rowCollapseAria'),
    expandAria: (hidden: number) => t('rowExpandAria', { n: hidden }),
    collapse: t('rowCollapse'),
    expand: (hidden: number) => t('rowExpand', { n: hidden }),
  }), [t])
  const open = rawPath !== undefined && path !== undefined && !failed && !interrupted
    ? () => {
      const line = lineArg(block.args)
      if (line === undefined) openFile(rawPath)
      else openFile(rawPath, { line })
    }
    : undefined
  const summaryNode = open !== undefined
    ? (
      <button
        type='button'
        className='snr-summaryLink'
        onClick={(event) => { event.stopPropagation(); open() }}
      >
        {note}
      </button>
    )
    : <span className={failed ? 'snr-summary snr-error' : 'snr-summary'}>{note}</span>
  const titleKey = TITLE_KEYS[toolName as keyof typeof TITLE_KEYS]
  return (
    <DisclosureRow
      icon={iconOf(toolName)}
      title={titleKey === undefined ? toolName : t(titleKey)}
      open={expanded}
      expandable={expandable}
      onToggle={toggle}
      running={!settled && !preparing}
      expandOnRowClick
      keepContentWhenOpen
      collapsedContent={(
        <>
          <span className='snr-sep' aria-hidden data-shimmer-decoration />
          {summaryNode}
        </>
      )}
    >
      <div className='snr-body'>
        {diffs.length > 0
          ? <DiffBlock diffs={diffs} labels={labels} maxLines={9} className='snr-diff' />
          : (
            <pre className='snr-pre' data-error={(failed || interrupted) ? '' : undefined}>
              {output ?? ''}
            </pre>
          )}
      </div>
    </DisclosureRow>
  )
}

/**
 * Register the shadow rows for the tools the user opted in for.
 * @param ctx - browser plugin context.
 * @param entries - tool name to its shadow priority; `replace` is true for every entry.
 * @returns the disposer restoring the native views.
 */
export function registerToolNoteRows(ctx: ClientContext, entries: ReadonlyMap<string, ToolCardConfig>): () => void {
  if (entries.size === 0) return () => {}
  ensureCss()
  const slots = ctx.slots as unknown as SlotRegistrySlice
  const removers: (() => void)[] = []
  const stop = slots.inject(TOOLVIEW_SLOT, () => {
    for (const [key, card] of entries) {
      if (!card.replace) continue
      removers.push(slots.register(
        { name: TOOLVIEW_SLOT, key, priority: card.priority, locale: NS },
        ToolNoteRow,
      ))
    }
    return () => {
      for (const remove of removers.splice(0)) remove()
    }
  })
  return () => {
    stop()
    for (const remove of removers.splice(0)) remove()
  }
}
