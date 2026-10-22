/**
 * Language-dependent default prompts, shared by the Host (assembly + route
 * defaults) and the browser settings page (blank fields display these).
 *
 * Chinese defaults translate the built-in prompts of bash/pwsh/run_code;
 * English defaults keep every tool's own description (the map is empty) and
 * only provide the global prompt for tools that have none.
 * @module @xiaoso/dsh-tool-step-note
 */

/** Languages the defaults exist for. */
export type PromptLanguage = 'zh' | 'en'

/** One language's default prompt text and per-tool overrides. */
export interface PromptDefaults {
  /** Global prompt used when a tool has no own prompt and no language default. */
  prompt: string
  /** Tool name to the prompt that replaces its own description. */
  toolPrompts: ReadonlyMap<string, string>
}

/** Chinese defaults: translated built-in prompts. */
const ZH: PromptDefaults = {
  prompt: '用中文一句话描述已经完成了什么，为了达到什么最终目标，接下来要做什么。',
  toolPrompts: new Map([
    ['bash', '用中文主动语态，简明说明这条命令在做什么，控制在 5 到 15 个词（会显示在界面上）。示例："ls" → "列出当前目录中的文件"；"git status" → "查看工作树状态"；"npm install" → "安装项目依赖"。'],
    ['pwsh', '用中文主动语态，简明说明这条命令在做什么，控制在 5 到 15 个词（会显示在界面上）。示例："ls" → "列出当前目录中的文件"；"git status" → "查看工作树状态"；"Get-Process" → "列出正在运行的进程"。'],
    ['run_code', '用中文主动语态，简明说明这段程序在做什么，控制在 5 到 15 个词（会显示在界面上）。示例："统计各包中的 TODO 标记"；"读取失败的测试及其夹具"；"重命名每个 cordis.yml 里的配置键"。'],
  ]),
}

/** English defaults: keep every tool's own description, English global prompt. */
const EN: PromptDefaults = {
  prompt: "One short sentence describing what this step does or is about to do, in the user's language. Shown next to the step in the UI.",
  toolPrompts: new Map(),
}

/** The defaults per language. */
export const LANGUAGE_PROMPTS: Readonly<Record<PromptLanguage, PromptDefaults>> = { zh: ZH, en: EN }

/**
 * Read one language's defaults.
 * @param language - resolved prompt language.
 * @returns that language's global prompt and per-tool overrides.
 */
export function languagePrompts(language: PromptLanguage): PromptDefaults {
  return LANGUAGE_PROMPTS[language]
}
