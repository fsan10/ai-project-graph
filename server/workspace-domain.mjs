export function emptyWorkspace(cwd) {
  return {
    version: 2,
    name: "未命名项目",
    cwd,
    phase: "planning",
    consensus: "",
    nodes: [],
    conversations: [
      { id: "main", nodeId: null, title: "项目主对话", messages: [] },
    ],
  };
}
export function validateBlueprint(value) {
  if (
    !value ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    typeof value.consensus !== "string" ||
    !value.consensus.trim() ||
    !Array.isArray(value.nodes) ||
    !value.nodes.length ||
    value.nodes.length > 40
  )
    throw new Error("架构方案格式不完整，请重新生成");
  const ids = new Set();
  for (const n of value.nodes) {
    if (
      !n.id ||
      ids.has(n.id) ||
      !["id", "title", "goal", "prompt"].every(
        (k) => typeof n[k] === "string" && n[k].trim(),
      ) ||
      !Array.isArray(n.dependencies) ||
      !Array.isArray(n.tasks) ||
      !n.tasks.length ||
      !n.tasks.every((t) => typeof t === "string" && t.trim())
    )
      throw new Error("节点目标、提示词或任务无效");
    ids.add(n.id);
  }
  const visited = new Set(),
    active = new Set();
  function visit(n) {
    if (active.has(n.id)) throw new Error("节点依赖存在循环");
    if (visited.has(n.id)) return;
    active.add(n.id);
    for (const id of n.dependencies) {
      if (!ids.has(id)) throw new Error("节点依赖不存在");
      visit(value.nodes.find((x) => x.id === id));
    }
    active.delete(n.id);
    visited.add(n.id);
  }
  value.nodes.forEach(visit);
  return {
    name: value.name,
    consensus: value.consensus,
    nodes: value.nodes.map((n) => ({
      ...n,
      summary: "",
      tasks: n.tasks.map((title, i) => ({
        id: `${n.id}-${i}`,
        title,
        status: "todo",
      })),
    })),
  };
}
export function nodeContext(state, node) {
  return `你负责项目中的一个节点。仅执行此节点范围；跨节点变更先说明。不要重复全面扫描代码，先使用交接信息，再按需读取相关文件。\n项目共识：${state.consensus}\n节点目标：${node.goal}\n职责提示词：${node.prompt}\n任务：${JSON.stringify(node.tasks)}\n已有交接：${node.summary || "暂无"}\n依赖交接：${JSON.stringify(state.nodes.filter((n) => node.dependencies.includes(n.id)).map((n) => ({ title: n.title, goal: n.goal, summary: n.summary })))}`;
}
export const nodeReplySchema = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "summary", "taskUpdates"],
  properties: {
    reply: { type: "string" },
    summary: { type: "string" },
    taskUpdates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "status", "evidence"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["in_progress", "in_review"] },
          evidence: { type: "string" },
        },
      },
    },
  },
};
export function applyNodeReply(node, result) {
  if (
    typeof result.reply !== "string" ||
    typeof result.summary !== "string" ||
    !Array.isArray(result.taskUpdates)
  )
    throw new Error("节点回复格式无效");
  for (const update of result.taskUpdates) {
    if (
      !node.tasks.some((t) => t.id === update.id) ||
      !["in_progress", "in_review"].includes(update.status) ||
      typeof update.evidence !== "string" ||
      !update.evidence.trim()
    )
      throw new Error("任务更新缺少有效的归属或验证证据");
  }
  node.summary = result.summary;
  for (const update of result.taskUpdates) {
    const task = node.tasks.find((t) => t.id === update.id);
    if (task.status !== "done") {
      task.status = update.status;
      task.evidence = update.evidence;
    }
  }
  return result.reply;
}
export const blueprintSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "consensus", "nodes"],
  properties: {
    name: { type: "string" },
    consensus: { type: "string" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "goal", "prompt", "dependencies", "tasks"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          goal: { type: "string" },
          prompt: { type: "string" },
          dependencies: { type: "array", items: { type: "string" } },
          tasks: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};
