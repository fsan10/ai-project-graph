# AI 项目图谱

在 Codex 中，以主对话规划项目，以架构节点组织执行和多段会话。新版采用真实 Codex App Server，不需要手动创建、复制或绑定对话 ID。

## 使用

要求 Node.js 22.13+、已登录的 Codex CLI（`codex` 在 PATH 中）。当前 Windows Codex 桌面安装附带的可执行程序已验证可用；也可以通过 `CODEX_BIN` 指定路径。

```powershell
npm install
npm start
```

打开 http://127.0.0.1:5173 。本地服务必须保持运行，静态构建本身不包含 Codex 引擎。

已启用 CDP 9231 的 Codex 桌面中运行：

```powershell
npm run codex
```

启动器自动启动本地工作台，并在 Codex 侧边栏添加、打开“项目图谱”。指定其他调试端口可运行 `node scripts/codex-project-graph-injector.mjs --port 端口 --watch --open`。普通浏览器也可以使用完整聊天功能。没有 CDP 的桌面可在原生浏览器面板打开本地地址；启动器不会强制退出或修改 Codex 安装文件。

## 工作流程

1. 新工作台只有一个空白主对话，没有预置架构或示例任务。开始前可设置项目代码目录。
2. 在主对话持续沟通目标、范围、技术约束和验收标准；规划阶段使用只读沙箱。
3. 点击“生成架构草案”，AI 根据已有对话产生项目共识、节点目标、职责提示词、依赖和小任务。
4. 查看架构图，继续沟通、重新生成，或点击“确认框架”。确认前不能开启节点执行。
5. 进入节点，直接开始对话。线程由服务创建和管理，同一对话自动续接。每个节点支持多段独立对话。
6. 新对话获取项目共识、节点职责、任务和直接依赖的交接摘要，不复制其他聊天历史。每次节点回复更新交接摘要，也可主动生成阶段摘要。
7. Codex 的任务报告更新侧边看板，并附验证证据。AI 最多提交“待验收”；用户验收为“已完成”。依赖未验收时，下游节点仅能只读讨论。

支持流式文字、命令/文件操作记录、停止生成、命令批准和提问回复。节点之间共享项目工作目录，不是自动建立独立 worktree；请避免同时运行修改相同文件的节点。当前版本由用户在节点发起执行，不会确认架构后自动并行启动所有节点。

## 数据与边界

- `.data/workspace-v2.json` 保存当前项目、图谱、任务、对话归属、文字记录和交接摘要；采用临时文件替换写入。
- Codex 自身保存真实线程；服务重启后自动使用已记录的线程恢复。无需用户填写 ID。
- 旧版浏览器数据保留，不自动导入新版空白工作台。当前一个服务对应一个工作台，可用 `GRAPH_DATA_DIR` 切换独立数据目录。
- 本地 API 绑定 loopback，并要求页面持有的随机 capability token；不提供公开云端聊天服务。
- 上下文交接减少无关历史传递，但没有实测 token 节省比例，也不能保证完全不重新读取代码。
- 这是使用 Codex 引擎的自定义工作台，不是完整复制桌面原生 UI；模型选择器、附件、diff 审阅器等原生功能尚未全部移植。

## 验证

```powershell
npm test
npm run build
node scripts/smoke-codex.mjs
node scripts/verify-workspace.mjs
```

前两项执行类型、领域验证及前端构建。后两项连接真实 Codex，会使用账户额度；完整验证在 `work/verify-*` 使用独立数据目录，不污染正式空白项目。

## 代码入口

- `components/project-graph/PlanningWorkspace.tsx`：主对话、节点会话、任务看板。
- `components/project-graph/ArchitectureCanvas.tsx`：按依赖层级排列的架构图。
- `server/codex-client.mjs`：stdio JSON-RPC、流式事件、交互请求。
- `server/workspace-plugin.mjs`：本地 API、持久化、线程生命周期、规划确认流程。
- `server/workspace-domain.mjs`：架构验证、上下文编译和任务报告验证。
- `scripts/codex-project-graph-injector.mjs`：Codex 侧边栏嵌入和本地资源桥接。

旧版领域模块暂留供迁移和回归测试，新入口不再加载旧版 ProjectGraphApp。原云端构建脚本保留为 `build:site`，不用于新版本地聊天服务。

## 参考

嵌入方式参考 [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard#embed-in-codex)。参考项目通过原生输入框发起任务并自动记录归属；本项目额外采用 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 实现在图谱界面内直接聊天。
