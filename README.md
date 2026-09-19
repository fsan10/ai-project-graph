# AI 项目图谱

在 Codex 原生界面中，用可自由拖动的无限画布整理一个项目内的对话。节点是对话分类，包含目标、职责提示词、小任务和交接摘要；每段对话显示真实 Codex 线程 ID，点击后进入原生历史和输入框。

## 启动

需要 Node.js 22.13+、已登录的 Codex 桌面和可用的 Codex CLI。可通过 CODEX_BIN 指定 CLI 路径。

```powershell
npm install
npm run skill:install
npm run codex
```

启动器构建界面、连接可用的 Codex 调试窗口，并在侧边栏添加“项目图谱”。Windows 上没有可用调试窗口时，会启动独立用户配置的 Codex 窗口，原有窗口继续运行。保持启动命令运行；退出后重新运行即可。不会修改 Codex 安装包。

已有指定 CDP 端口时：

```powershell
npm run build
node scripts/codex-project-graph-injector.mjs --port 9232 --watch --open
```

独立浏览器可用 npm start 后打开 http://127.0.0.1:5173 检查图谱；打开和新建原生对话需要 Codex 内的嵌入入口。嵌入页 /codex-native.html 使用构建后的资源，代码修改后重新 npm run build。

## 使用流程

1. 在 Codex 原生界面创建或选择项目、开启对话，输入 `$project-graph` 和项目想法。也可以从图谱的“原生规划对话”进入预填提示的原生输入框。
2. 在同一原生对话持续沟通，Skill 维护详细开发文档。确认前图谱保持空白，不自动生成示例节点。
3. 明确确认文档后，Skill 发布节点、依赖和任务。侧边栏“项目图谱”中选择对应的已有 Codex 项目即可查看。
4. 自由拖动节点、拖动背景平移、滚轮缩放；Shift 多选或框选，Ctrl+A 全选。布局自动保存；新增节点时填写目标和初始职责提示词。
5. 节点的第一段对话是“记忆主对话”。它使用 Codex 原生输入框，第一阶段只回答、提问和总结，不修改项目代码；与 AI 对齐模块颗粒度、边界和验收标准后，Skill 固化核心记忆。
6. 记忆确认后，“从节点记忆分支新对话”调用 Codex 原生 `thread/fork`。新线程继承完整对齐历史、自动归入节点并显示真实 ID，无需重复发送记忆或手动绑定。
7. 点击已有对话进入原生历史并继续聊。已有未分类对话仍可归入节点；删除节点分类保留 Codex 原生对话。
8. 在画布按 Ctrl+F，仅搜索当前项目的原生对话标题、预览和 ID；勾选历史搜索可检索消息内容。结果由原生 App Server 提供，点击后打开原生对话。
9. 任务看板同时显示节点状态和节点内小任务。用户将节点标为完成后，图谱自动更新项目状态文档；新节点与新分支都会读取最新完成情况。

## 数据和集成边界

- 项目选择来源是 Codex 已有本地项目；不提供另一套项目创建和文件夹绑定流程。
- 原生 Codex 管理历史、输入、模型、附件、权限和执行。图谱只保存分类、任务、文档、摘要及真实线程 ID，不复制聊天记录。
- `.codex/project-graph/project-status.md` 记录所有节点的完成情况；`.codex/project-graph/nodes/` 保存每个节点的稳定核心记忆。详细讨论仍留在原生记忆主对话中。
- 项目数据存于 .data/native/<projectId>.json，原子写入；旧版数据保留。可用 GRAPH_DATA_DIR 指定独立存储。
- 本地 API 仅监听 loopback，使用随机访问令牌。Skill 通过 .data/native-runtime.json 连接服务。
- 当前支持本地 Codex 项目；原生项目归属优先于工作目录，并兼容已归属项目的 worktree 线程。云端项目尚未接入。
- 原生桥接依赖桌面当前的路由和消息协议，桌面升级后可能需要适配。项目内搜索弹层是扩展界面，打开后的聊天界面是 Codex 原生界面。
- 节点提供职责和上下文边界，不会自动启动一批后台 agent，也不自动隔离代码目录。是否开始执行由原生对话指令决定。
- 上下文交接避免传入无关聊天历史，但没有实测 token 节省比例，也不能保证无需重新读取代码。

## 开发与验证

```powershell
npm test
npm run build
node scripts/verify-native-graph.mjs
```

集成验证使用独立临时数据目录，读取真实原生项目与线程，验证项目隔离、确认门槛、自动归类及布局持久化，不向 Codex 发送模型请求。

主要入口：

- components/project-graph/NativeGraphApp.tsx：无限画布、节点弹层、项目内搜索和任务看板。
- server/native-graph-plugin.mjs：本地 API、原生线程读取、持久化和静态嵌入资源。
- server/native-graph-domain.mjs：图谱操作、发布确认、节点上下文。
- server/native-catalog.mjs：原生项目目录与线程归属。
- public/codex-project-graph.user.js：原生侧边栏入口、原生新建和历史导航。
- scripts/graphctl.mjs 与 skills/project-graph/：配套 Skill 和自动登记 CLI。

旧版自定义聊天组件保留供迁移，新入口不再加载它们。

## 参考

原生嵌入和导航方式参考 [dashi-taskboard](https://github.com/chuspeeism/dashi-taskboard#embed-in-codex)，该项目采用 Apache 2.0 许可，见 [第三方说明](THIRD_PARTY_NOTICES.md)。线程读取使用 [Codex App Server](https://learn.chatgpt.com/docs/app-server)。
