---
name: project-graph
description: 在 Codex 原生对话中规划项目、对齐节点记忆、从记忆主对话创建工作分支，并维护项目图谱、任务状态与交接文档。用户提到项目图谱、节点分类、节点记忆或调用 project-graph 时使用。
---

# 项目图谱

使用当前 Codex 原生项目和原生对话。图谱负责分类、节点记忆、任务与交接，不创建另一套项目或聊天服务，也不复制完整聊天历史。

CLI 位于本 Skill 的 `scripts/graphctl.mjs`。用 `node <该绝对路径> <命令>` 调用；运行失败时如实说明，不声称已经发布、对齐或归类。`projects` 列出现有项目，`status --project <id>` 读取图谱。项目内执行通常可按当前目录匹配项目。

## 项目规划

在原生规划对话持续沟通目标用户、痛点、流程、范围、非目标、技术约束、模块责任、风险、测试和验收。维护详细开发文档，通常为 `docs/project-development.md`。只有用户明确认可最终文档，才发布图谱；确认前继续修订，不启动节点实现。

确认后准备图谱 JSON：

```json
{
  "name": "项目名称",
  "document": "完整的已确认开发文档 Markdown",
  "nodes": [
    {
      "id": "稳定ID",
      "title": "节点名",
      "goal": "目标与边界",
      "prompt": "职责、相关文件和接口约束",
      "tasks": ["可验收小任务"]
    }
  ],
  "edges": [{ "source": "依赖节点ID", "target": "下游节点ID", "label": "依赖" }]
}
```

执行 `node <graphctl> publish --file <JSON绝对路径> --confirmed`。后续修订保留节点 ID，以保留原生对话、记忆和手动布局。

## 节点记忆主对话

节点的第一段对话是“记忆主对话”。如果入口提示要求登记记忆主线，先运行：

`node <graphctl> register --project <projectId> --node <nodeId> --role memory`

再运行 `context --project <projectId> --node <nodeId>`。此阶段只回答、提问、澄清与总结；除上述图谱命令外，不执行实现命令，不修改项目代码或业务文件。结合开发文档、节点目标与职责、直接依赖和项目状态，与用户持续对齐：

- 要完成的核心能力与不做的内容；
- 模块颗粒度、接口与数据边界；
- 关键决策和硬约束；
- 可验证的完成标准。

不要把首次描述当成最终结论。只有用户明确确认节点核心内容后，写一个 JSON 文件：

```json
{
  "summary": "这个节点稳定、完整但紧凑的核心记忆",
  "acceptance": "完成和验收边界",
  "decisions": ["已确认决策"],
  "constraints": ["必须遵守的约束"]
}
```

执行 `node <graphctl> align --project <projectId> --node <nodeId> --file <JSON绝对路径>`。成功后告知用户可以从画布创建原生工作分支。不要在记忆主对话中直接开始实现。

## 原生工作分支

画布从记忆主对话调用 Codex `thread/fork` 创建工作分支，因此分支已继承完整对齐历史，也已自动归入节点；不要再次登记或重复发送节点记忆。

开始工作前读取 `context` 返回的 `files.projectStatus`。它记录所有节点的最新完成情况；只在需要核对稳定结论时读取 `files.nodeMemory`。这样可获得创建分支后发生的项目进展，而无需重新扫描整个项目或读取其他聊天历史。

根据用户当前请求推进本节点工作。只读取相关代码；跨节点变更先说明。阶段完成时准备：

```json
{
  "summary": "关键决策、涉及文件、验证结果和未完成事项",
  "tasks": [
    { "id": "任务ID", "status": "in_review", "evidence": "实际验证与结果" }
  ]
}
```

执行 `report --project <projectId> --node <nodeId> --file <报告绝对路径>`。任务状态只提交 `in_progress` 或 `in_review`；没有验证不能声称完成。用户在图谱内将节点或任务标为完成。

节点完成后，图谱自动更新 `.codex/project-graph/project-status.md`；每个新节点与新分支都读取这份状态。原生历史仍由 Codex 管理，图谱只保存线程关系、稳定记忆、任务与交接。
