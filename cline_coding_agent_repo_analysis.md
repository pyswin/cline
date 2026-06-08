# Cline Coding Agent 仓库结构与二次开发分析

生成时间：2026-06-08  
仓库路径：`/Users/myfile/Documents/cline`

## 1. 总览结论

这个仓库是一个 Cline coding agent monorepo。它不是单一 VSCode 插件项目，而是同时包含：

- VSCode 扩展产品：`apps/vscode`
- CLI 产品：`apps/cli`
- Hub 服务：`apps/cline-hub`
- 可复用 SDK：`sdk/packages/*`
- 示例、评测、文档、规则、Hooks、Workflows

如果目标是基于 Cline 做自己的 coding agent 产品，建议分两条线理解：

1. **当前 VSCode 产品线**：主要逻辑在 `apps/vscode/src/core/task`、`apps/vscode/src/core/controller`、`apps/vscode/webview-ui`。
2. **新 SDK 抽象线**：主要逻辑在 `sdk/packages/core`、`sdk/packages/agents`、`sdk/packages/llms`、`sdk/packages/shared`。

实际改功能时要先判断功能属于哪一类：

- 改 VSCode UI、按钮、设置页、聊天展示：优先改 `apps/vscode/webview-ui` 和 `apps/vscode/src/core/controller`。
- 改工具调用、文件编辑、终端执行、agent loop：优先看 `apps/vscode/src/core/task`，如果要做跨端能力，再同步设计到 `sdk/packages/*`。
- 改模型供应商、模型参数、流式解析：看 `apps/vscode/src/core/api` 和 `sdk/packages/llms`。
- 改插件化、Skills、MCP、Hooks、Workflows：看 `apps/vscode/src/core/context`、`apps/vscode/src/core/hooks`、`apps/vscode/src/services/mcp`，以及 SDK 的 `extensions/*`。

## 2. 顶层目录说明

### `.github`

GitHub issue 模板、CI workflow、辅助脚本。  
如果要维护自己的 GitHub 仓库，CI、release、test matrix 基本会放这里。

### `.husky`

Git hooks。通常用于提交前 lint、format、typecheck。

### `.vscode`

开发该扩展自身时的 VSCode 配置。

### `.cline`、`.clinerules`、`Rules`、`Hooks`、`Workflows`

Cline 自身的规则、Hooks、工作流配置。  
这些目录体现了 Cline 的“可配置 agent 行为”设计：

- rules：注入系统提示或项目规范。
- hooks：工具调用前后执行脚本。
- workflows：封装常见任务流程。

如果要做 Coduora 类产品，Skill/Workflow 最好沿用这种“文件配置 + watcher”的路线，而不是把所有逻辑硬编码进 TypeScript。

### `apps`

应用层，包含不同宿主：

- `apps/vscode`：核心 VSCode 扩展。
- `apps/cli`：命令行版本。
- `apps/cline-hub`：Hub 服务。
- `apps/examples`：SDK/CLI/多 agent 示例。

### `sdk`

新的跨端 SDK 层。根据 `sdk/ARCHITECTURE.md`，分层是：

```text
@cline/shared
  -> @cline/llms
  -> @cline/agents
  -> @cline/core
  -> apps
```

这里是长期更适合作为“核心 agent runtime”的地方。

### `docs`

面向用户和开发者的文档，包括 tools reference、MCP、SDK、CLI、best practices 等。

### `evals`

评测、benchmark、smoke tests。  
如果要做更严肃的 coding agent，建议保留并扩展这一层，用回归任务衡量 agent 修改代码、跑测试、修失败的能力。

### `assets`

图标、文档资源、图片等。

### `node_modules`

依赖目录。当前仓库已经安装过依赖。

## 3. 包管理与构建

顶层 `package.json` 使用 Bun workspace：

```json
"packageManager": "bun@1.3.13",
"engines": {
  "bun": "1.3.13",
  "node": ">=22"
}
```

主要 scripts：

- `bun run build`：清理、安装、构建 SDK 和 CLI。
- `bun run build:sdk`：构建 `sdk/packages/*`。
- `bun run code`：开发 VSCode 相关代码。
- `bun run test`：并行跑 SDK 和 CLI 测试。
- `bun run test:unit`：核心单测。
- `bun run check`：format/lint/build/typecheck/publish check。

注意：顶层 workspace 明确排除了 `apps/vscode`：

```json
"workspaces": [
  "sdk/packages/*",
  "apps/*",
  "!apps/vscode",
  ...
]
```

这说明 `apps/vscode` 仍然有独立依赖管理，里面存在自己的 `package-lock.json`、`node_modules`、`webview-ui/package.json`。

## 4. VSCode 扩展层：`apps/vscode`

这是当前产品最重要的目录。

### 4.1 `apps/vscode/package.json`

定义 VSCode 扩展元信息：

- `main`: `./dist/extension.js`
- `activationEvents`: `onLanguage`、`onUri`、`onStartupFinished` 等
- `contributes.viewsContainers`: Activity Bar 入口
- `contributes.views`: Sidebar WebView
- `contributes.commands`: 新任务、设置、历史、MCP、解释代码、改进代码、生成 commit message 等命令

如果要改扩展名、图标、命令、菜单、入口按钮，优先改这里和 `apps/vscode/src/registry.ts`。

### 4.2 启动入口：`apps/vscode/src/extension.ts`

`activate(context)` 是 VSCode 扩展入口。它做了几件关键事：

1. 设置 `HostProvider`，把 VSCode 能力适配成统一 host 接口。
2. 做历史存储迁移。
3. 调 `initialize(storageContext)` 做通用初始化。
4. 注册 sidebar WebView。
5. 注册 VSCode commands。
6. 注册 diff virtual document provider。
7. 处理 URI deep link。

典型启动链路：

```text
VSCode activate()
  -> setupHostProvider()
  -> initialize()
  -> HostProvider.createWebviewProvider()
  -> VscodeWebviewProvider
  -> Controller
```

### 4.3 通用初始化：`apps/vscode/src/common.ts`

`initialize()` 是跨宿主通用初始化：

- 初始化 endpoint 配置。
- 初始化 `StateManager`。
- 初始化错误服务、遥测服务。
- 创建 WebView provider。
- 启动后台 sync worker。
- 清理 temp 文件。
- 初始化文件上下文 tracker。

如果要加全局服务，例如自定义 telemetry、企业配置、统一模型配置、远程 policy，通常放在这里或它调用的服务层。

### 4.4 WebView Provider

关键文件：

- `apps/vscode/src/hosts/vscode/VscodeWebviewProvider.ts`
- `apps/vscode/src/core/webview/WebviewProvider.ts`

`VscodeWebviewProvider` 负责：

- 创建 sidebar webview。
- 加载 webview HTML。
- 监听 WebView 消息。
- 将消息转为 `grpc_request` 交给 controller。
- 把 extension 侧事件发回 UI。

消息链路：

```text
React WebView
  -> grpc_request
  -> VscodeWebviewProvider.handleWebviewMessage()
  -> handleGrpcRequest()
  -> Controller method
  -> ExtensionMessage / event
  -> React WebView
```

### 4.5 Controller：`apps/vscode/src/core/controller`

`Controller` 是 VSCode 产品层的中枢。关键文件：

- `apps/vscode/src/core/controller/index.ts`
- `apps/vscode/src/core/controller/task/newTask.ts`
- `apps/vscode/src/core/controller/state/*`
- `apps/vscode/src/core/controller/models/*`
- `apps/vscode/src/core/controller/file/*`
- `apps/vscode/src/core/controller/mcp/*`

`Controller` 持有：

- 当前 `Task`
- `McpHub`
- 账号服务
- Auth 服务
- `StateManager`
- workspace manager

创建任务链路：

```text
WebView NewTaskRequest
  -> newTask(controller, request)
  -> controller.initTask(...)
  -> new Task(...)
  -> task.startTask()
```

如果要增加新的前端按钮或设置项，通常要：

1. 在 WebView UI 发出 grpc request。
2. 在 proto / grpc handler 中加接口。
3. 在 `controller/*` 下实现逻辑。
4. 必要时更新 `StateManager`。

## 5. Task 和 Agent 执行层

核心目录：

```text
apps/vscode/src/core/task
```

这里是当前 VSCode 版 Cline 的 agent loop。

### 5.1 `Task`

关键文件：

```text
apps/vscode/src/core/task/index.ts
```

`Task` 负责一次用户任务的完整生命周期：

- 初始化 API handler。
- 管理终端。
- 管理 browser session。
- 管理 diff view provider。
- 管理 context manager。
- 管理 checkpoint。
- 管理 file/model/environment context tracker。
- 创建 `ToolExecutor`。
- 处理模型流式输出。
- 解析 assistant message。
- 执行工具。
- 保存任务历史。

可以把它理解成：

```text
Task = conversation state + model stream + tool loop + UI side effects
```

### 5.2 流式输出处理

相关文件：

- `StreamResponseHandler.ts`
- `StreamChunkCoordinator.ts`
- `StreamResponseHandler`
- `assistant-message/parse-assistant-message.ts`

大致流程：

```text
API stream
  -> StreamResponseHandler
  -> parseAssistantMessageV2
  -> text blocks / tool_use blocks
  -> ToolExecutor.executeTool()
```

这说明 Cline 的默认工具调用不是“函数调用 API 绑定死”，而是兼容多种模型输出格式，并解析成统一 `ToolUse`。

### 5.3 ToolExecutor

关键文件：

- `apps/vscode/src/core/task/ToolExecutor.ts`
- `apps/vscode/src/core/task/tools/ToolExecutorCoordinator.ts`
- `apps/vscode/src/core/task/tools/handlers/*`

调用链：

```text
Task
  -> ToolExecutor.executeTool(block)
  -> ToolExecutorCoordinator.getHandler(block.name)
  -> handler.execute(config, block)
  -> tool result pushed into conversation
```

`ToolExecutor` 负责把 Task 内部依赖打包成 `TaskConfig`：

- `taskState`
- `messageState`
- `api`
- `cwd`
- `workspaceManager`
- `mcpHub`
- `browserSession`
- `diffViewProvider`
- `fileContextTracker`
- `clineIgnoreController`
- `commandPermissionController`
- `contextManager`
- `stateManager`
- callbacks: `say`、`ask`、`saveCheckpoint`、`executeCommandTool` 等

这个设计让每个工具 handler 不需要直接依赖整个 Task。

## 6. 工具系统

### 6.1 工具枚举

关键文件：

```text
apps/vscode/src/shared/tools.ts
```

`ClineDefaultTool` 定义工具名：

- `ask_followup_question`
- `attempt_completion`
- `execute_command`
- `replace_in_file`
- `read_file`
- `write_to_file`
- `search_files`
- `list_files`
- `list_code_definition_names`
- `browser_action`
- `use_mcp_tool`
- `web_fetch`
- `web_search`
- `apply_patch`
- `use_skill`
- `use_subagents`

`READ_ONLY_TOOLS` 定义哪些工具不会改 workspace，可用于并发和安全策略。

### 6.2 工具注册

关键文件：

```text
apps/vscode/src/core/task/tools/ToolExecutorCoordinator.ts
```

`toolHandlersMap` 把 `ClineDefaultTool` 映射到 handler：

```text
execute_command -> ExecuteCommandToolHandler
read_file -> ReadFileToolHandler
write_to_file -> WriteToFileToolHandler
replace_in_file -> WriteToFileToolHandler
apply_patch -> ApplyPatchHandler
web_search -> WebSearchToolHandler
use_skill -> UseSkillToolHandler
use_subagents -> UseSubagentsToolHandler
```

新增工具时，通常需要：

1. 在 `shared/tools.ts` 增加 enum。
2. 在 `core/prompts/system-prompt/tools/` 增加 prompt 描述。
3. 在 `core/prompts/system-prompt/tools/index.ts` 导出。
4. 在 `ToolExecutorCoordinator.ts` 注册 handler。
5. 在 `core/task/tools/handlers/` 实现 handler。
6. 如果涉及 UI 展示，在 `webview-ui/src/components/chat` 增加展示组件或复用现有 row。
7. 加测试：handler test、prompt snapshot、Task 工具流程测试。

### 6.3 命令执行工具

关键文件：

```text
apps/vscode/src/core/task/tools/handlers/ExecuteCommandToolHandler.ts
apps/vscode/src/integrations/terminal/*
```

它负责：

- 参数校验：必须有 `command` 和 `requires_approval`。
- 根据命令类型推断 timeout。
- 多 workspace 命令前缀解析，例如 `@backend:npm test`。
- `CLINE_COMMAND_PERMISSIONS` 权限校验。
- `.clineignore` 校验。
- auto approve 策略。
- 用户审批 UI。
- 调用 terminal executor。

如果要改命令安全策略，优先看：

- `CommandPermissionController`
- `ExecuteCommandToolHandler`
- `apps/vscode/src/integrations/terminal`
- `AutoApprovalSettings`

### 6.4 文件编辑工具

主要有两套：

1. `write_to_file` / `replace_in_file`
2. `apply_patch`

关键文件：

```text
apps/vscode/src/core/task/tools/handlers/WriteToFileToolHandler.ts
apps/vscode/src/core/task/tools/handlers/ApplyPatchHandler.ts
apps/vscode/src/integrations/editor/DiffViewProvider.ts
apps/vscode/src/integrations/editor/FileEditProvider.ts
```

`apply_patch` 更适合做强 coding agent，因为它可以表达多文件 patch：

```text
*** Begin Patch
*** Add File: ...
*** Update File: ...
*** Delete File: ...
*** End Patch
```

`ApplyPatchHandler` 做了：

- patch 解析。
- 文件路径解析和 workspace 校验。
- diff preview。
- 用户审批。
- 文件读写。
- telemetry。

如果要加“模型生成统一 diff 后应用”的能力，建议复用 `apply_patch`，不要绕开它直接写文件。

### 6.5 MCP、Skills、Subagents

相关文件：

- `apps/vscode/src/services/mcp/McpHub.ts`
- `apps/vscode/src/core/task/tools/handlers/UseMcpToolHandler.ts`
- `apps/vscode/src/core/task/tools/handlers/UseSkillToolHandler.ts`
- `apps/vscode/src/core/task/tools/subagent/*`
- `apps/vscode/src/core/context/instructions/user-instructions/skills`

这部分支撑扩展能力：

- MCP：外部工具服务器。
- Skills：可复用任务流程。
- Subagents：动态 agent 工具。

如果要实现“代码审查、模板生成、代码统计、项目初始化”等 Skill 工作流，应该优先走 Skill/Workflow 配置体系，而不是硬塞进 system prompt。

## 7. Prompt 系统

关键目录：

```text
apps/vscode/src/core/prompts/system-prompt
```

结构：

- `components/`：系统提示的模块化片段，如 role、capabilities、rules、skills、tool_use。
- `tools/`：每个工具的 prompt 描述。
- `variants/`：不同模型族的 prompt 变体。
- `registry/`：PromptRegistry、PromptBuilder、ClineToolSet。
- `templates/`：模板引擎。
- `__tests__/__snapshots__`：prompt 快照。

新增或修改工具后，必须同步 prompt，否则模型不知道怎么调用。

如果改系统提示，建议：

1. 修改对应 component 或 variant。
2. 跑 prompt snapshot test。
3. 比较不同模型族输出，不要只看一个模型。

## 8. 模型与 Provider

VSCode 老实现：

```text
apps/vscode/src/core/api/providers/*
apps/vscode/src/core/api/transform/*
```

SDK 新实现：

```text
sdk/packages/llms/src/providers/*
sdk/packages/llms/src/catalog/*
```

支持方向包括：

- Anthropic
- OpenAI
- OpenAI compatible
- Gemini / Vertex
- Bedrock
- OpenRouter
- Ollama
- LM Studio
- DeepSeek
- Qwen
- Doubao
- Claude Code
- OpenAI Codex

新增模型 provider 时，要判断走哪条线：

- 只改 VSCode 当前产品：加 `apps/vscode/src/core/api/providers/<provider>.ts`，再补 settings UI 和 model refresh。
- 做长期跨端：加到 `sdk/packages/llms/src/providers`，通过 `@cline/llms` gateway 暴露。

## 9. WebView UI

目录：

```text
apps/vscode/webview-ui/src
```

主要结构：

- `App.tsx`：前端入口。
- `components/chat`：聊天消息、工具展示、diff、命令输出。
- `components/settings`：设置页和模型选择。
- `components/mcp`：MCP UI。
- `components/history`：历史任务。
- `components/account`：账号和 credits。
- `context/ExtensionStateContext.tsx`：扩展状态上下文。
- `services/grpc-client.ts`：WebView 到 extension 的 RPC 客户端。

如果要加新 UI：

- 新按钮/菜单：看 `components/menu/Navbar.tsx`、`components/chat/ChatView.tsx`。
- 新工具展示：看 `CommandOutputRow.tsx`、`DiffEditRow.tsx`、`SearchResultsDisplay.tsx`。
- 新设置项：看 `components/settings/SettingsView.tsx` 和 `ApiOptions.tsx`。
- 新状态字段：需要同步 proto、state、controller、React context。

## 10. SDK 新架构

`sdk/ARCHITECTURE.md` 明确说明了分层。

### 10.1 `sdk/packages/shared`

低层共享：

- 类型、schema
- hook contracts
- prompt/parsing helpers
- storage path
- remote-config
- telemetry
- tool 创建基础设施

设计原则：不能依赖高层 runtime。

### 10.2 `sdk/packages/llms`

模型和 provider：

- provider config
- model catalogs
- gateway
- vendor adapters
- stream handling

设计原则：provider-specific 行为集中在这里。

### 10.3 `sdk/packages/agents`

无状态 agent loop：

- agent iteration loop
- tool orchestration
- runtime event emission
- hook/extension execution
- turn preparation

关键文件：

```text
sdk/packages/agents/src/agent-runtime.ts
```

它支持两种使用方式：

- 传入 prebuilt model。
- 传 providerId/modelId/API key，由 `@cline/llms` 创建 model。

### 10.4 `sdk/packages/core`

有状态编排层：

- session lifecycle
- storage / persistence
- runtime host
- settings API
- plugin loading
- MCP
- hooks
- hub server
- cron
- default tools

关键入口：

```text
sdk/packages/core/src/ClineCore.ts
```

典型使用：

```ts
const cline = await ClineCore.create({ clientName: "my-app" })
const session = await cline.start({ ... })
```

### 10.5 SDK 工具定义

关键文件：

```text
sdk/packages/core/src/extensions/tools/definitions.ts
sdk/packages/core/src/extensions/tools/schemas.ts
sdk/packages/core/src/extensions/tools/runtime.ts
```

这里定义新版工具：

- `read_files`
- `search_codebase`
- `run_commands`
- `apply_patch`
- `edit_file`
- `fetch_web_content`
- `skills`
- `submit`

如果你要把 Cline 改造成更可维护的商业 coding agent，长期建议把核心能力放进 SDK 层，而不是只改 `apps/vscode/src/core/task`。

## 11. 一次任务的端到端链路

```text
用户在 WebView 输入任务
  -> React grpc-client
  -> VscodeWebviewProvider.handleWebviewMessage()
  -> handleGrpcRequest()
  -> controller/task/newTask.ts
  -> Controller.initTask()
  -> new Task()
  -> Task 构造 API handler、terminal、browser、diff、context、ToolExecutor
  -> Task 发送 system prompt + history + user task 给模型
  -> 模型流式返回 text/tool use
  -> parseAssistantMessageV2()
  -> ToolExecutor.executeTool()
  -> ToolExecutorCoordinator 路由 handler
  -> handler 执行工具并 ask/say 更新 UI
  -> 工具结果写回 conversation
  -> 下一轮模型调用
  -> attempt_completion
  -> 保存 history/checkpoint/telemetry
```

这是典型 agent loop：

```text
LLM -> tool -> observation -> LLM -> tool -> observation -> completion
```

## 12. 如果要添加新功能，应该怎么改

### 12.1 添加一个新工具

例：添加 `analyze_dependencies` 工具。

需要改：

1. `apps/vscode/src/shared/tools.ts`
   - 增加 `ClineDefaultTool.ANALYZE_DEPENDENCIES`。
   - 如果是只读工具，加入 `READ_ONLY_TOOLS`。

2. `apps/vscode/src/core/prompts/system-prompt/tools/analyze_dependencies.ts`
   - 写清楚工具用途、参数、示例。

3. `apps/vscode/src/core/prompts/system-prompt/tools/index.ts`
   - 导出该工具 prompt。

4. `apps/vscode/src/core/task/tools/handlers/AnalyzeDependenciesHandler.ts`
   - 实现 handler。

5. `apps/vscode/src/core/task/tools/ToolExecutorCoordinator.ts`
   - 注册 tool -> handler。

6. UI 展示
   - 如果复用普通 tool 展示可以不改。
   - 如果要专门展示依赖图/表格，改 `apps/vscode/webview-ui/src/components/chat`。

7. 测试
   - handler 单测。
   - prompt snapshot。
   - Task 工具调用集成测试。

### 12.2 添加一个新模型 Provider

只做 VSCode 产品：

1. `apps/vscode/src/core/api/providers/<provider>.ts`
2. `apps/vscode/src/core/api/index.ts`
3. `apps/vscode/src/core/controller/models/*`
4. `apps/vscode/webview-ui/src/components/settings/*ModelPicker.tsx`
5. `apps/vscode/src/shared/api.ts`

做长期 SDK：

1. `sdk/packages/llms/src/providers/vendors/<provider>.ts`
2. `sdk/packages/llms/src/providers/registry.ts`
3. `sdk/packages/llms/src/providers/types.ts`
4. provider live/vcr tests
5. model catalog 更新

### 12.3 添加一个新设置项

例：新增“自动生成测试后必须运行测试”开关。

需要改：

1. storage schema：`apps/vscode/src/shared/storage/state-keys.ts`
2. controller state update：`apps/vscode/src/core/controller/state/updateSettings.ts`
3. WebView state context：`ExtensionStateContext.tsx`
4. settings UI：`SettingsView.tsx` 或对应 section
5. 使用处：Task/ToolExecutor/handler
6. 默认值和迁移：StateManager 或 migration

### 12.4 添加 Skill 工作流

推荐路线：

1. 设计 Skill manifest。
2. 放到 `.cline/skills` 或仓库内 Skills 目录。
3. 复用 `UseSkillToolHandler`。
4. 如果需要 UI 展示，补 `Skill` 相关 row。
5. 如果要远程下发，走 remote-config materializer。

不要把 Skill 写死到 system prompt；否则难维护、难灰度、难做团队配置。

### 12.5 添加测试修复闭环

推荐复用现有工具：

```text
execute_command -> parse test output -> read_file/search_files -> apply_patch -> execute_command
```

需要新增的不是底层工具，而是上层策略：

- prompt 中明确测试失败处理步骤。
- 可选增加 `parse_test_output` 工具。
- 增加 verifier：判断任务是否真正完成。
- 增加 trace/replay：保存失败任务用于回归。

适合放置位置：

- VSCode 快速实现：`apps/vscode/src/core/task` + prompt components。
- 长期实现：`sdk/packages/core/src/extensions/tools` + `sdk/packages/agents` hook。

## 13. 二次开发建议

### 13.1 短期：基于 VSCode 现有 Task 改

适合目标：

- 快速做出 Coduora 风格 VSCode 产品。
- 保留 Cline 的 UI、审批、diff、terminal。
- 加自己的模型、工具、Skill、默认 prompt。

改造重点：

- branding：`apps/vscode/package.json`、assets、registry。
- 默认模型和 provider：`core/api/providers`、settings UI。
- system prompt：`core/prompts/system-prompt`。
- 新工具：`core/task/tools`。
- Skill 工作流：`UseSkillToolHandler`、skills discovery。

### 13.2 中期：抽 agent-core 到 SDK

适合目标：

- 同时支持 VSCode、CLI、服务端任务。
- GitHub 仓库长期维护。
- 避免所有产品逻辑被 VSCode 绑死。

建议结构：

```text
packages/
  agent-core/
  tools/
  skills/
  sandbox/
  llm/
apps/
  vscode/
  cli/
  server/
```

当前仓库已经有 SDK 分层，可以沿用 `sdk/packages/*`。

### 13.3 长期：以评测驱动能力迭代

建议保留：

- `evals`
- smoke tests
- task replay
- prompt snapshot
- tool handler unit tests

每新增一个 agent 能力，都应该有 fixture，例如：

- 新增函数并补测试。
- 修复失败测试。
- 跨文件重构。
- 解析日志定位 bug。
- 读 README 初始化项目。
- 安全拒绝危险命令。

## 14. 常见修改入口速查

| 想改什么 | 主要入口 |
| --- | --- |
| VSCode 扩展启动 | `apps/vscode/src/extension.ts` |
| WebView 消息 | `VscodeWebviewProvider.ts`、`grpc-handler.ts` |
| 新建任务 | `core/controller/task/newTask.ts`、`Controller.initTask()` |
| Agent loop | `core/task/index.ts` |
| 工具执行 | `core/task/ToolExecutor.ts`、`ToolExecutorCoordinator.ts` |
| 工具 handler | `core/task/tools/handlers/*` |
| 工具 prompt | `core/prompts/system-prompt/tools/*` |
| 工具枚举 | `shared/tools.ts` |
| 文件编辑 | `WriteToFileToolHandler.ts`、`ApplyPatchHandler.ts`、`DiffViewProvider.ts` |
| 命令执行 | `ExecuteCommandToolHandler.ts`、`integrations/terminal/*` |
| MCP | `services/mcp/McpHub.ts` |
| Skills | `UseSkillToolHandler.ts`、`context/instructions/user-instructions/skills` |
| Provider | `core/api/providers/*`、`sdk/packages/llms/src/providers/*` |
| 设置页 | `webview-ui/src/components/settings/*` |
| 聊天 UI | `webview-ui/src/components/chat/*` |
| 状态管理 | `core/storage/StateManager.ts`、`shared/storage/state-keys.ts` |
| SDK 入口 | `sdk/packages/core/src/ClineCore.ts` |
| SDK agent loop | `sdk/packages/agents/src/agent-runtime.ts` |
| SDK 默认工具 | `sdk/packages/core/src/extensions/tools/*` |

## 15. 对 Coduora 类产品的推荐改造路线

### Phase 1：产品换壳和默认能力

- 改 displayName、图标、README、命令名。
- 固定或优先展示自家推荐模型。
- 调整默认 system prompt。
- 增加企业/实验室规则。

### Phase 2：增强 coding loop

- 强制使用 `apply_patch` 优先编辑。
- 增加 test repair prompt。
- 增加 `parse_test_output` 工具。
- 增加 verifier：检查 diff、测试、用户目标是否一致。

### Phase 3：Skill 工作流

内置 Skills：

- code review
- unit test generation
- template generation
- code statistics
- project initialization
- bug fix
- dependency analysis

### Phase 4：Trace 和 Replay

- 保存每次任务的 prompt、工具调用、diff、命令输出。
- 提供 replay CLI。
- 建立 benchmark fixtures。
- 每次改 prompt/tool 都跑回归。

### Phase 5：SDK 化

- 把核心 agent loop 和工具能力迁移到 SDK。
- VSCode 只作为 host。
- CLI/server 共享同一 runtime。

## 16. 风险点

1. **老 VSCode 实现和新 SDK 并存**  
   改功能前要确认目标路径，不要同一能力两边各改一半。

2. **工具 prompt 和 handler 必须同步**  
   只加 handler 不加 prompt，模型不会稳定调用；只加 prompt 不加 handler，会运行时报错。

3. **审批和安全不能绕开**  
   文件写入、命令执行应该复用现有 ask/auto-approve/permission 体系。

4. **Provider 分散**  
   老 provider 在 `apps/vscode/src/core/api`，新 provider 在 `sdk/packages/llms`。长期要收敛。

5. **WebView 状态链路较长**  
   UI 新状态通常涉及 proto、grpc、controller、StateManager、React context，不能只改一个组件。

## 17. 最实用的开发建议

如果现在马上要加一个“完整版 coding agent 能力”，优先做：

1. 复用 `apply_patch`，不要另写写文件工具。
2. 在 prompt 里强化“先读文件、再补丁、再测试、失败后修复”。
3. 新增 `parse_test_output` 只读工具。
4. 在 `ToolExecutorCoordinator` 注册该工具。
5. 在 UI 复用 `CommandOutputRow` 展示测试输出。
6. 增加 replay/evals，别只靠手测。

这条路线能最大程度保留 Cline 已有能力，同时把产品差异点放在 agent 策略、Skill 和评测闭环上。

