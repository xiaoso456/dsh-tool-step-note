<div align="center">

# Step Note

给 DeepSeek Harness 的工具加一句由模型填写的步骤说明，让你看懂模型现在正在做什么。

简体中文 | [English](./README.en.md)

[![npm version](https://img.shields.io/npm/v/@xiaoso/dsh-tool-step-note?logo=npm)](https://www.npmjs.com/package/@xiaoso/dsh-tool-step-note)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19%20%7C%20%3E%3D24-339933?logo=nodedotjs)](https://nodejs.org)
[![DeepSeek Harness 0.2.x](https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4d6bfe.svg)](https://github.com/deepseek-ai/deepseek-harness)

</div>

## 功能特性

- **为工具调用添加描述字段**：启用的工具会多一个由模型填写的 `description`，显示在对话的步骤行和工具卡片上。
- **支持工具自定义描述字段提示词**：可以按语言、按工具覆盖这句描述的提示词。

## 安装

### 从 npm 安装

需要 Node.js ≥ 22.19（或 ≥ 24）和 DeepSeek Harness 0.2.1+。

**网页版**

```bash
dsh plugin --profile web add @xiaoso/dsh-tool-step-note
dsh web
```

**桌面端**

1. 侧边栏打开「**插件**」，点「**添加插件**」→「**安装第三方插件**」。
2. 填入 `@xiaoso/dsh-tool-step-note`，点「**安装**」。
3. 重启 DeepSeek Harness。

安装后设置里出现「**工具步骤说明**」。

## 使用

### 基本设置

- **启用步骤说明**：总开关。
- **设为必填**：默认关闭；打开后，没有单独设置的工具都要求模型必须填写这句说明。每个工具可以在「工具」页单独覆盖。
- **默认提示词语言**：自动跟随界面语言；也可以固定中文或英文。留空的提示词会跟随所选语言。
- **步骤说明提示词**：没有单独提示词、也没有自带描述的工具用它。

![基本设置](docs/settings.png)

### 工具

默认开启：edit、read、write、bash、pwsh、grep、glob、job_list、job_output、job_kill。

每个勾选的工具有三项设置：

| 设置 | 作用 | 默认 |
| --- | --- | --- |
| **单独设置提示词** | 整段替换这个工具的提示词；不改动时跟随所选语言 | 默认未勾选 |
| **必填** | 模型必须填写这句说明 | 跟随「基本设置」，可单独覆盖 |
| **替换工具卡片** | 用插件的一行卡片代替原生卡片，说明常驻；优先级必须小于 0（默认 -1000） | read、write、edit 开启 |

**默认替换 read、write、edit**：它们的原生卡片显示路径，不显示说明；不替换的话，说明只在运行中闪一下。bash、pwsh、grep、glob 等原生卡片已经显示说明；任务、目标、计划等是结果卡片；ask_user_question、skill、present 是交互界面，所以这些保留原生卡片。替换后原生详情不复现，但文件路径和 diff 仍在。

### run_code

run_code 是 PTC 模式的工具。它本来就有步骤说明，且始终必填，插件不会再加第二个字段；「单独设置提示词」默认未勾选，使用内置提示词，修改后固定使用你的文字。

### 试一下

在标准模式下可以直接发这句，触发多个工具看效果：

```text
帮我做一次项目体检：读一下 package.json、tsconfig 和 tsdown.config.ts，搜一下还有没有遗留的 TODO，然后跑一次 pnpm build。只做检查，不要改文件，最后把结果告诉我。
```

想测 run_code 的卡片，切到 PTC 模式再让它打印 1+1。

## 说明

- 插件只改「模型看到的 schema」，不改工具注册时的参数校验。
- 步骤行里的说明只在工具「运行中」显示；read、write 这类瞬间结束的工具，默认靠替换卡片把说明留下来。
- 参数根声明 `additionalProperties: false` 的工具会跳过；固定过程描述（enum、const）的工具不能修改；MCP 工具可能不接受额外参数，启用前请确认对应服务允许额外字段。
- 提示词语言每次请求都会重新解析；卡片替换在保存后立即重新注册。

## License

[MIT](LICENSE)
