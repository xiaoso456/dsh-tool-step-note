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
import type { StepNoteValue } from './values.ts'

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
    inject: (): StepNoteSectionInjected => ({ form }),
  }, StepNoteSection))), 'step-note: settings page')

  // The note on settled tool cards follows the shared settings form: the same
  // document the page edits, including writes made elsewhere. Registration is
  // dynamic because the native view must come back the moment the switch goes
  // off; the slot layer has no "empty placeholder" that could fall through.
  ctx.effect(() => {
    let stop: (() => void) | undefined
    const sync = (): void => {
      const value = form.getSnapshot().value
      const on = value?.enabled !== false && value?.toolRows === true
      if (on && stop === undefined) {
        stop = registerToolNoteRows(ctx)
      } else if (!on && stop !== undefined) {
        stop()
        stop = undefined
      }
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
