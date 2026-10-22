# AGENTS.md

给在本仓库里干活的代理（和人）看的说明。只讲验证、打包、发包和 changelog。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm build` | 构建 `lib/`：宿主、客户端、类型 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | 注入与语言默认值断言 |
| `npm pack --dry-run --json` | 列出 npm 包会带哪些文件 |
| `npm publish --dry-run` | 发布预演：跑 `prepublishOnly`、打印 tarball 与目标源 |

改宿主代码要重启 dsh；只改客户端刷新页面即可。link 安装的 profile 不会自动更新 `lib/`，先 `pnpm build`。Node 版本以 `package.json` 的 `engines` 为准。

## 打包检查

`lib/` 是构建产物、在 `.gitignore` 里，但必须进 npm 包。发版前必须现构建，不要拿旧产物打包。

```sh
pnpm build && pnpm typecheck && pnpm test
npm pack --dry-run --json
```

包里必须有：`lib/index.mjs`、`lib/client.js`、`lib/types/**`、两版 README、`LICENSE`、`docs/settings.png`、`cordis.patch.yml`、`locale/*.json`。

包里不应出现：`src/`、`test/`、`tmp/`、`.playwright-mcp/`、`node_modules/`、`*.log`。

加运行期文件时同时改 `package.json` 的 `files` 和 `exports`；`*.tgz` 不进仓库。可选：用临时 profile 安装 tarball 冒烟，验完删掉。

## 发布与推送

发版前确认：

- `npm whoami` 有权限；没有就 `npm login`。scoped 包要能发，`.npmrc` 里的 scope 必须指向官方源。
- `publishConfig.access: public` 不能删，否则 scoped 包会按 restricted 发。
- 没有 remote 就跳过推送，不要写不存在的仓库地址。

```sh
pnpm build && pnpm typecheck && pnpm test
npm pack --dry-run --json
# 更新 CHANGELOG 对应版本；不更新不发版
pnpm version <patch|minor|major> --no-git-tag-version
git commit -am "release: step-note v<ver>"
git tag step-note-v<ver>
npm publish          # 预发布用 --tag beta，不要落 latest
# 有远端时
git push && git push --tags
gh release create step-note-v<ver> --title "v<ver>" --notes-file <notes 文件>
```

- `prepublishOnly` 会再跑一遍构建与检查；手动那遍仍要跑，别等发布时才失败。
- 版本按严格 SemVer，看公共接口：工具 schema、设置字段、RPC 路由、peer 区间。新增能力 → minor；修 bug、改措辞、重构 → patch；删改接口或让旧配置读不了 → major。
- 不兼容变更在 CHANGELOG 里写清谁受影响、要做什么。
- peer 与 `engines.dsh` 用同一串区间，`devDependencies` 钉精确版本；具体口径以 `package.json` 为准。
- 发版后用 `npm view <包名> version` 确认。

## CHANGELOG 写法

每节原样贴进 Release，写给用户看。

- 小节用 Added / Changed / Fixed，必要时 Other（不兼容、迁移、依赖、开发者接口）。
- 一条一句，句末带句号，最多用分号接一个分句；不分子条目、不加粗标题。
- 写用户能感知的结果，不写组件名、CSS、RPC、源码路径；界面上的名字、命令、设置项照写。
- 新增用「新增 / 支持」，优化用「优化 / 改善」，修复写「修复〈什么情况下〉〈出了什么问题〉的问题」；不写「以前……现在……」。
- 同一处的小改合成一条；重构、测试不写；这一版新加又在这一版修掉的问题不写进「问题修复」。
- 每版发版前必须加一节，已发布版本的段落不改写，写错在下一版修正。
- 例：差「工具选项块的背景色换了个色值」；好「展开多个工具时选项块和上方提示词用同一种底色，分隔线不再被边框盖住。」

## DSH 版本

- peer 写三段版本区间，禁用 `^`；`engines.dsh` 与 peer 同串。
- `devDependencies` 钉精确版本，配合 lockfile。
- 换支持版本线时，peer、`engines.dsh`、dev 版本、两版 README 一起改。
- peer 对不上时宿主静默跳过；先查 `<profile>/cordis.yml` 里这个插件的行。

## 不要提交

`lib/`、`tmp/`、`.playwright-mcp/`、`.dsh-meow/`、`node_modules/`、`*.tgz`、`*.log`。
