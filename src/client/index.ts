/**
 * Step Note, browser half: the plugin's own Settings page bound to the
 * `step-note` namespace.
 *
 * The Host half owns the namespace (its entry id) and calls
 * `settings.configure({ auto: false })` so no schema page is generated; this
 * page registers through `configForms.whileServed([NS], ...)`, so a deployment
 * that does not serve the namespace shows no trace of it.
 * @module @xiaoso/dsh-tool-step-note/client
 */

// Type-only: pulls the settings SlotMap declarations (`settings.section`) and
// the `ctx.configForms` Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the `ctx.locale` Context merge (dictionary registration).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { StepNoteSection, type StepNoteSectionInjected } from './StepNoteSection.tsx'
import { registerToolNoteRows } from './ToolNoteRow.tsx'
import { NS } from './namespace.ts'
import { en, zh } from './locales.ts'
import { parseToolNames, type StepNoteValue } from './values.ts'
import { parseToolCards, serializeToolCards } from '../tool-cards.ts'

/** Settings namespace; the Host entry id is the same string. */
export { NS }

/** Required services: slots + locale + the shared configuration forms. */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Mount the Step Note settings page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'step-note: page dictionaries')

  // Tell the Host which interface language is on screen, so `auto` prompt
  // defaults follow the UI even when no locale preference has been saved yet.
  const reportLanguage = (): void => {
    const active = ctx.locale.getLocale().active.toLowerCase()
    void fetch('/step-note/active-language', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: active.startsWith('zh') ? 'zh' : 'en' }),
    }).catch(() => {})
  }
  ctx.on('locale/change', reportLanguage)
  reportLanguage()

  // One shared form per namespace: the page reads and writes the same document
  // the Host serves for the `step-note` entry.
  const form = ctx.configForms.get<StepNoteValue>(NS)

  // The page sits right after the official Plugins section (order 16).
  ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: 17,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: (): StepNoteSectionInjected => ({
      form,
      // Read at render time: the slot re-renders when the locale changes.
      uiLanguage: () => ctx.locale.getLocale().active.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    }),
  }, StepNoteSection))), 'step-note: settings page')

  // The note on settled tool cards follows the shared settings form: the same
  // document the page edits, including writes made elsewhere. Registration is
  // dynamic because the native view must come back the moment a tool is turned
  // off; the slot layer has no "empty placeholder" that could fall through.
  // The signature covers both the selected tools and their priorities, so an
  // edit re-registers instead of keeping the old shadow row.
  ctx.effect(() => {
    let stop: (() => void) | undefined
    let applied = ''
    const sync = (): void => {
      const value = form.getSnapshot().value
      const cards = value?.enabled === false ? new Map() : parseToolCards(value?.toolCards)
      const enabledTools = value?.enabledTools === undefined ? undefined : parseToolNames(value.enabledTools)
      const selected = new Map([...cards].filter(([name, card]) => card.replace
        && (enabledTools === undefined || enabledTools.has(name))))
      const signature = serializeToolCards(selected)
      if (signature === applied) return
      applied = signature
      stop?.()
      stop = undefined
      if (selected.size > 0) stop = registerToolNoteRows(ctx, selected)
    }
    const unsubscribe = form.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      stop?.()
      stop = undefined
    }
  }, 'step-note: tool card notes')
}
