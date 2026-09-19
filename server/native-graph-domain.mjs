import { createHash, randomUUID } from "node:crypto";

const now = () => new Date().toISOString();
const memory = () => ({
  status: "draft",
  summary: "",
  acceptance: "",
  decisions: [],
  constraints: [],
  version: 0,
  updatedAt: null,
});
const nodeState = (node) => ({
  ...node,
  status: node.status || "todo",
  completedAt: node.completedAt || null,
  rootThreadId: node.rootThreadId || null,
  conversations:
    node.conversations ||
    (node.threadIds || []).map((threadId) => ({
      threadId,
      kind: threadId === node.rootThreadId ? "memory" : "imported",
      parentThreadId: null,
      createdAt: null,
    })),
  memory: { ...memory(), ...(node.memory || {}) },
});

export const normalizeGraph = (graph) => ({
  ...graph,
  version: 4,
  updatedAt: graph.updatedAt || graph.confirmedAt || now(),
  nodes: (graph.nodes || []).map(nodeState),
});

export const graphFor = (project) => ({
  version: 4,
  projectId: project.id,
  name: project.name,
  revision: 0,
  nodes: [],
  edges: [],
  document: null,
  confirmedAt: null,
  updatedAt: now(),
});

const label = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 10000)
    throw new Error("名称或内容无效");
  return value.trim();
};
const stringList = (value) =>
  Array.isArray(value)
    ? value
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];
const touch = (graph) => {
  graph.revision++;
  graph.updatedAt = now();
  return graph;
};

export function changeGraph(input, action) {
  const graph = normalizeGraph(input);
  if (action.revision !== undefined && action.revision !== graph.revision)
    throw new Error("图谱已更新，请重试当前操作");
  const next = structuredClone(graph);
  if (action.action === "node-add") {
    next.nodes.push({
      id: randomUUID(),
      title: label(action.title),
      goal: String(action.goal || "").slice(0, 20000),
      prompt: String(action.prompt || "").slice(0, 20000),
      summary: "",
      status: "todo",
      completedAt: null,
      memory: memory(),
      rootThreadId: null,
      conversations: [],
      x: action.x ?? 100,
      y: action.y ?? 100,
      threadIds: [],
      tasks: [],
    });
  } else if (action.action === "node-edit") {
    const node = next.nodes.find((n) => n.id === action.nodeId);
    if (!node) throw new Error("节点不存在");
    if (action.title !== undefined) node.title = label(action.title);
    let invalidatesMemory = false;
    for (const key of ["goal", "prompt", "summary"]) {
      if (action[key] === undefined) continue;
      const value = String(action[key]).slice(0, 20000);
      if ((key === "goal" || key === "prompt") && value !== node[key])
        invalidatesMemory = true;
      node[key] = value;
    }
    if (invalidatesMemory && node.memory.status === "ready")
      node.memory.status = "stale";
  } else if (action.action === "node-delete") {
    next.nodes = next.nodes.filter((n) => n.id !== action.nodeId);
    next.edges = next.edges.filter(
      (e) => e.source !== action.nodeId && e.target !== action.nodeId,
    );
  } else if (action.action === "layout") {
    if (
      !Array.isArray(action.positions) ||
      action.positions.some(
        (p) =>
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          !next.nodes.some((n) => n.id === p.id),
      )
    )
      throw new Error("节点坐标无效");
    action.positions.forEach((p) =>
      Object.assign(
        next.nodes.find((n) => n.id === p.id),
        { x: p.x, y: p.y },
      ),
    );
  } else if (action.action === "edge-add") {
    if (
      action.source === action.target ||
      !next.nodes.some((n) => n.id === action.source) ||
      !next.nodes.some((n) => n.id === action.target)
    )
      throw new Error("连线端点无效");
    if (
      !next.edges.some(
        (e) => e.source === action.source && e.target === action.target,
      )
    )
      next.edges.push({
        id: randomUUID(),
        source: action.source,
        target: action.target,
        label: action.label || "关联",
      });
  } else if (action.action === "edge-delete") {
    next.edges = next.edges.filter((e) => e.id !== action.edgeId);
  } else if (action.action === "assign") {
    if (action.nodeId && !next.nodes.some((n) => n.id === action.nodeId))
      throw new Error("节点不存在");
    const owner = next.nodes.find((n) => n.rootThreadId === action.threadId);
    if (owner && owner.id !== action.nodeId)
      throw new Error("节点记忆主对话不能直接移动");
    next.nodes.forEach((n) => {
      n.threadIds = n.threadIds.filter((id) => id !== action.threadId);
      n.conversations = n.conversations.filter(
        (conversation) => conversation.threadId !== action.threadId,
      );
    });
    if (action.nodeId) {
      const node = next.nodes.find((n) => n.id === action.nodeId);
      node.threadIds.push(action.threadId);
      node.conversations.push({
        threadId: action.threadId,
        kind: "imported",
        parentThreadId: null,
        createdAt: now(),
      });
    }
  } else if (action.action === "conversation-link") {
    const node = next.nodes.find((n) => n.id === action.nodeId);
    if (!node) throw new Error("节点不存在");
    if (!action.threadId) throw new Error("对话 ID 无效");
    if (action.kind === "memory") {
      if (node.rootThreadId && node.rootThreadId !== action.threadId)
        throw new Error("节点已经有记忆主对话，请从主对话创建分支");
      node.rootThreadId = action.threadId;
      node.memory.status =
        node.memory.status === "ready" ? "ready" : "aligning";
    } else if (action.kind === "branch") {
      if (!node.rootThreadId || node.memory.status !== "ready")
        throw new Error("请先完成节点记忆对齐，再创建工作分支");
      if (action.parentThreadId !== node.rootThreadId)
        throw new Error("工作分支必须来自节点记忆主对话");
    }
    if (!node.threadIds.includes(action.threadId))
      node.threadIds.push(action.threadId);
    const existing = node.conversations.find(
      (conversation) => conversation.threadId === action.threadId,
    );
    const relation = {
      threadId: action.threadId,
      kind: action.kind || "imported",
      parentThreadId: action.parentThreadId || null,
      createdAt: action.createdAt || now(),
    };
    if (existing) Object.assign(existing, relation);
    else node.conversations.push(relation);
  } else if (action.action === "memory-align") {
    const node = next.nodes.find((n) => n.id === action.nodeId);
    if (!node?.rootThreadId) throw new Error("节点还没有记忆主对话");
    node.memory = {
      status: "ready",
      summary: label(action.summary).slice(0, 20000),
      acceptance: String(action.acceptance || "").slice(0, 10000),
      decisions: stringList(action.decisions),
      constraints: stringList(action.constraints),
      version: (node.memory.version || 0) + 1,
      updatedAt: now(),
    };
    node.summary = node.memory.summary;
    if (node.status === "todo") node.status = "ready";
  } else if (action.action === "node-status") {
    const node = next.nodes.find((n) => n.id === action.nodeId);
    if (!node) throw new Error("节点不存在");
    if (
      !["todo", "ready", "in_progress", "in_review", "done"].includes(
        action.status,
      )
    )
      throw new Error("节点状态无效");
    if (action.status === "done" && node.memory.status !== "ready")
      throw new Error("节点记忆尚未对齐，不能标记完成");
    node.status = action.status;
    node.completedAt = action.status === "done" ? now() : null;
  } else if (action.action === "task") {
    const owner = next.nodes.find((n) =>
      n.tasks.some((task) => task.id === action.taskId),
    );
    const task = owner?.tasks.find((item) => item.id === action.taskId);
    if (
      !task ||
      !["todo", "in_progress", "in_review", "done"].includes(action.status)
    )
      throw new Error("任务状态无效");
    task.status = action.status;
    if (owner.status !== "done" && action.status === "in_progress")
      owner.status = "in_progress";
  } else throw new Error("未知图谱操作");
  const updated = touch(next);
  if (action.action === "layout") updated.updatedAt = graph.updatedAt;
  return updated;
}

export function publishGraph(input, spec, confirmation) {
  const graph = normalizeGraph(input);
  if (confirmation !== true)
    throw new Error("只有用户明确确认开发文档后才能生成架构");
  if (
    typeof spec.document !== "string" ||
    !spec.document.trim() ||
    !Array.isArray(spec.nodes) ||
    !spec.nodes.length
  )
    throw new Error("缺少开发文档或架构节点");
  const ids = new Set();
  for (const node of spec.nodes) {
    label(node.id);
    label(node.title);
    label(node.goal);
    if (ids.has(node.id)) throw new Error("节点 ID 重复");
    ids.add(node.id);
  }
  const nodes = spec.nodes.map((node, index) => {
    const old = graph.nodes.find((item) => item.id === node.id);
    const prompt = node.prompt || node.goal;
    const memoryChanged =
      old && (old.goal !== node.goal || old.prompt !== prompt);
    return nodeState({
      id: node.id,
      title: node.title,
      goal: node.goal,
      prompt,
      summary: old?.summary || "",
      status: old?.status || "todo",
      completedAt: old?.completedAt || null,
      memory: old
        ? {
            ...old.memory,
            ...(memoryChanged && old.memory.status === "ready"
              ? { status: "stale" }
              : {}),
          }
        : memory(),
      rootThreadId: old?.rootThreadId || null,
      conversations: old?.conversations || [],
      x: old?.x ?? (index % 3) * 330 + 80,
      y: old?.y ?? Math.floor(index / 3) * 240 + 100,
      threadIds: old?.threadIds || [],
      tasks: (node.tasks || []).map((task, taskIndex) => ({
        id: `${node.id}-${taskIndex}`,
        title: typeof task === "string" ? task : label(task.title),
        status:
          old?.tasks.find(
            (existing) =>
              existing.id === `${node.id}-${taskIndex}` &&
              existing.title === (typeof task === "string" ? task : task.title),
          )?.status || "todo",
      })),
    });
  });
  const edges = (spec.edges || []).map((edge) => {
    if (
      !ids.has(edge.source) ||
      !ids.has(edge.target) ||
      edge.source === edge.target
    )
      throw new Error("无效的架构连线");
    return {
      id: randomUUID(),
      source: edge.source,
      target: edge.target,
      label: edge.label || "依赖",
    };
  });
  const retained = graph.nodes.filter((node) => !ids.has(node.id));
  return touch({
    ...graph,
    name: spec.name || graph.name,
    nodes: [...nodes, ...retained],
    edges: [
      ...edges,
      ...graph.edges.filter((edge) =>
        retained.some(
          (node) => node.id === edge.source || node.id === edge.target,
        ),
      ),
    ],
    document: spec.document,
    confirmedAt: now(),
  });
}

const statusName = {
  todo: "待对齐",
  ready: "待开始",
  in_progress: "进行中",
  in_review: "待验收",
  done: "已完成",
};

export function projectStateMarkdown(input) {
  const graph = normalizeGraph(input);
  const done = graph.nodes.filter((node) => node.status === "done");
  const lines = [
    `# ${graph.name} · 项目状态`,
    "",
    "> 由 AI 项目图谱自动维护。新节点和节点分支应先读取本文件，不需要重新扫描整个项目。",
    "",
    `- 更新时间：${graph.updatedAt}`,
    `- 总进度：${done.length}/${graph.nodes.length} 个节点完成`,
    `- 已确认开发文档：${graph.confirmedAt ? "是" : "否"}`,
    "",
    "## 节点状态",
    "",
  ];
  if (!graph.nodes.length) lines.push("尚无节点。", "");
  for (const node of graph.nodes) {
    lines.push(
      `### ${node.title} · ${statusName[node.status] || node.status}`,
      "",
      `- 节点 ID：${node.id}`,
      `- 目标：${node.goal || "待补充"}`,
      `- 节点记忆：${node.memory.status === "ready" ? `v${node.memory.version}` : node.memory.status}`,
      `- 核心结论：${node.memory.summary || node.summary || "尚未完成对齐"}`,
      `- 对话：${node.threadIds.length} 段（${node.conversations.filter((item) => item.kind === "branch").length} 个原生分支）`,
    );
    if (node.completedAt) lines.push(`- 完成时间：${node.completedAt}`);
    if (node.tasks.length) {
      lines.push("- 子任务：");
      for (const task of node.tasks)
        lines.push(
          `  - [${task.status === "done" ? "x" : " "}] ${task.title}（${statusName[task.status] || task.status}）`,
        );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function nodeMemoryMarkdown(input, nodeId) {
  const graph = normalizeGraph(input);
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("节点不存在");
  const dependencies = graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => graph.nodes.find((item) => item.id === edge.source))
    .filter(Boolean);
  return [
    `# ${node.title} · 节点记忆`,
    "",
    "> 详细对齐过程保存在节点记忆主对话；本文件只保存稳定结论，工作分支由主对话原生派生。",
    "",
    `- 节点 ID：${node.id}`,
    `- 状态：${statusName[node.status] || node.status}`,
    `- 记忆版本：${node.memory.version}`,
    `- 记忆状态：${node.memory.status}`,
    `- 记忆主对话：${node.rootThreadId || "尚未创建"}`,
    `- 更新时间：${node.memory.updatedAt || graph.updatedAt}`,
    "",
    "## 初始目标",
    "",
    node.goal || "待补充",
    "",
    "## 职责提示词",
    "",
    node.prompt || "待补充",
    "",
    "## 对齐后的核心记忆",
    "",
    node.memory.summary || "尚未完成只读对齐。",
    "",
    "## 验收边界",
    "",
    node.memory.acceptance || "待对齐",
    "",
    "## 已确认决策",
    "",
    ...(node.memory.decisions.length
      ? node.memory.decisions.map((item) => `- ${item}`)
      : ["- 暂无"]),
    "",
    "## 约束",
    "",
    ...(node.memory.constraints.length
      ? node.memory.constraints.map((item) => `- ${item}`)
      : ["- 暂无"]),
    "",
    "## 直接依赖交接",
    "",
    ...(dependencies.length
      ? dependencies.map(
          (item) =>
            `- ${item.title}：${item.memory.summary || item.summary || "尚无交接"}`,
        )
      : ["- 无"]),
    "",
    "## 当前子任务",
    "",
    ...(node.tasks.length
      ? node.tasks.map(
          (task) =>
            `- [${task.status === "done" ? "x" : " "}] ${task.title}（${statusName[task.status] || task.status}）`,
        )
      : ["- 无"]),
  ].join("\n");
}

export function memoryFileName(nodeId) {
  const slug = String(nodeId)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 70);
  const hash = createHash("sha256")
    .update(String(nodeId))
    .digest("hex")
    .slice(0, 8);
  return `${slug || "node"}-${hash}.md`;
}

export function contextForNode(input, nodeId) {
  const graph = normalizeGraph(input);
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("节点不存在");
  const related = new Set(
    graph.edges
      .filter((edge) => edge.target === nodeId)
      .map((edge) => edge.source),
  );
  return {
    project: graph.name,
    node: {
      id: node.id,
      title: node.title,
      goal: node.goal,
      prompt: node.prompt,
      status: node.status,
      memory: node.memory,
      rootThreadId: node.rootThreadId,
      summary: node.summary,
      tasks: node.tasks,
    },
    dependencies: graph.nodes
      .filter((item) => related.has(item.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        goal: item.goal,
        summary: item.memory.summary || item.summary,
      })),
    projectState: graph.nodes.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      completedAt: item.completedAt,
      summary: item.memory.summary || item.summary,
    })),
    document: graph.document,
  };
}
