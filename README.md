# AI Project Graph

> Stop managing AI coding by chat. Manage it by architecture.

AI Project Graph 是一个以软件架构为主目录的 AI Coding 工作台。Architecture Node 是长期实体；Codex Conversation、任务、代码证据、Git 与 Checkpoint 都是节点下的工作记录和事实来源。

## MVP 能力

- 创建 Greenfield、Existing 或 Hybrid 项目，并自动建立 Project Architect。
- 编辑和确认结构化 Project Blueprint，确认后递增 Graph Version。
- 使用稳定 ID 管理 Node / Edge / Hierarchy。
- 在无限画布中平移、缩放、拖动、搜索、创建节点和连接关系。
- Architecture、Dependency、Progress、Runtime、Evidence 五种 Lens 共享同一份图数据。
- 保存完整 Codex Binding：Thread、Project、Project Kind、Host 与 Workspace。
- 按 Global + Dependency + Node + Current Thread 四层编译最小上下文。
- Agent 只能将节点推进到 In Review；Done 只能由用户执行 Accept & Complete。
- 人工完成时自动创建 Checkpoint，并更新 Project State。
- Repository Evidence 采用 fail-closed 校验：相对路径、合法行号与 40 位 Commit SHA 缺一不可。
- 所有写入都使用全局 revision 与 Node version；旧 revision 会返回 VERSION_CONFLICT。
- Graph Diagnostics 检查稳定 ID、父级循环、未知端点、依赖循环、节点重叠、无 Checkpoint 的 Done 与无效 Evidence。
- 项目以 JSON 快照导入/导出；浏览器版本默认保存在当前设备。

## 本地运行

要求 Node.js 22.13 或更高版本。

~~~bash
npm install
npm run dev
~~~

生产验证：

~~~bash
npm run typecheck
npm run lint
npm test
~~~

## Codex Bridge 契约

用户点击已绑定 Conversation 时，页面会派发：

~~~js
window.addEventListener("ai-project-graph:open-conversation", (event) => {
  const binding = event.detail;
  // binding.threadId
  // binding.codexProjectId
  // binding.codexProjectKind
  // binding.codexHostId
  // binding.workspacePath
});
~~~

桌面壳或 Codex 注入层只需要监听这个事件并打开对应原生 Thread。浏览器独立运行时会复制 Thread ID，确保绑定信息不会丢失。

## 设计边界

本版本完成 PRD 的 P0 验收闭环。P1 的 Architecture Delta、Target vs Current、Decision Log、Global Search、Git Branch / Worktree 与 P2 的 Repository 自动发现、多 Agent 调度仍保留在后续 Graph Version 中，不会被伪装成已经实现。
