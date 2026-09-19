import test from "node:test";
import assert from "node:assert/strict";
import {
  graphFor,
  changeGraph,
  publishGraph,
  contextForNode,
  projectStateMarkdown,
  nodeMemoryMarkdown,
} from "../server/native-graph-domain.mjs";
import { belongsToProject, projectForCwd } from "../server/native-catalog.mjs";
const project = {
  id: "p1",
  canonicalId: "canonical1",
  name: "项目",
  path: process.cwd(),
  roots: [process.cwd()],
};
const fixture = () =>
  publishGraph(
    graphFor(project),
    {
      document: "# 已确认文档",
      nodes: [
        { id: "a", title: "前端", goal: "界面", tasks: ["可访问"] },
        { id: "b", title: "数据", goal: "数据契约", tasks: [] },
      ],
      edges: [{ source: "b", target: "a" }],
    },
    true,
  );
test("empty native project does not create a conversation or seeded architecture", () => {
  const g = graphFor(project);
  assert.deepEqual(g.nodes, []);
  assert.equal(g.document, null);
  assert.equal(g.confirmedAt, null);
});
test("confirmed publication is required and later revisions preserve dragged positions and native IDs", () => {
  assert.throws(() => publishGraph(graphFor(project), {}, false), /确认/);
  let g = fixture();
  g = changeGraph(g, {
    action: "assign",
    nodeId: "a",
    threadId: "native-thread",
  });
  g = changeGraph(g, {
    action: "layout",
    positions: [{ id: "a", x: -340, y: 721 }],
  });
  const updated = publishGraph(
    g,
    {
      document: "v2",
      nodes: [{ id: "a", title: "前端更新", goal: "界面", tasks: ["可访问"] }],
      edges: [],
    },
    true,
  );
  assert.equal(updated.nodes[0].x, -340);
  assert.deepEqual(updated.nodes[0].threadIds, ["native-thread"]);
  assert.ok(updated.nodes.some((n) => n.id === "b"));
});
test("moving a thread changes its category; removing a category does not delete native history", () => {
  let g = fixture();
  g = changeGraph(g, { action: "assign", nodeId: "a", threadId: "t" });
  g = changeGraph(g, { action: "assign", nodeId: "b", threadId: "t" });
  assert.deepEqual(g.nodes[0].threadIds, []);
  assert.deepEqual(g.nodes[1].threadIds, ["t"]);
  g = changeGraph(g, { action: "node-delete", nodeId: "b" });
  assert.equal(g.edges.length, 0);
  assert.equal(g.nodes.length, 1);
});
test("multi drag is atomic, rejects stale versions and non-finite coordinates", () => {
  const g = fixture();
  assert.throws(
    () => changeGraph(g, { action: "layout", revision: -1, positions: [] }),
    /更新/,
  );
  assert.throws(
    () =>
      changeGraph(g, {
        action: "layout",
        positions: [{ id: "a", x: NaN, y: 4 }],
      }),
    /坐标/,
  );
  assert.equal(g.nodes[0].x, 80);
  const next = changeGraph(g, {
    action: "layout",
    positions: [
      { id: "a", x: 1, y: 2 },
      { id: "b", x: 9, y: 10 },
    ],
  });
  assert.equal(next.nodes[1].x, 9);
});
test("project scoping rejects foreign assigned threads even when cwd matches", () => {
  assert.equal(
    belongsToProject({ id: "x", cwd: project.path }, project, {
      assignments: { x: "p2" },
    }),
    false,
  );
  assert.equal(
    belongsToProject({ id: "x", cwd: project.path }, project, {
      assignments: { x: { projectId: "p2", projectKind: "local" } },
    }),
    false,
  );
  assert.equal(
    belongsToProject({ id: "x", cwd: project.path }, project, {
      assignments: {},
    }),
    true,
  );
  assert.equal(projectForCwd([project], project.path).id, "p1");
});
test("node context carries the direct dependency handoff rather than other native chat histories", () => {
  const g = fixture();
  g.nodes[1].summary = "接口约定";
  const c = contextForNode(g, "a");
  assert.equal(c.dependencies[0].summary, "接口约定");
  assert.equal("messages" in c, false);
  assert.equal(c.node.goal, "界面");
});
test("node memory must be aligned before native work branches can inherit it", () => {
  let g = fixture();
  g = changeGraph(g, {
    action: "conversation-link",
    nodeId: "a",
    threadId: "root-thread",
    kind: "memory",
  });
  assert.equal(g.nodes[0].memory.status, "aligning");
  assert.throws(
    () =>
      changeGraph(g, {
        action: "conversation-link",
        nodeId: "a",
        threadId: "branch-1",
        kind: "branch",
        parentThreadId: "root-thread",
      }),
    /完成节点记忆对齐/,
  );
  g = changeGraph(g, {
    action: "memory-align",
    nodeId: "a",
    summary: "界面只负责展示稳定 API",
    acceptance: "通过无障碍检查",
    decisions: ["使用原生组件"],
    constraints: ["不改服务端"],
  });
  g = changeGraph(g, {
    action: "conversation-link",
    nodeId: "a",
    threadId: "branch-1",
    kind: "branch",
    parentThreadId: "root-thread",
  });
  assert.equal(g.nodes[0].rootThreadId, "root-thread");
  assert.equal(g.nodes[0].conversations[1].parentThreadId, "root-thread");
  assert.equal(g.nodes[0].memory.version, 1);
});
test("user completion updates shared project state and node memory documents", () => {
  let g = fixture();
  g = changeGraph(g, {
    action: "conversation-link",
    nodeId: "a",
    threadId: "root",
    kind: "memory",
  });
  g = changeGraph(g, {
    action: "memory-align",
    nodeId: "a",
    summary: "前端模块完成登录展示",
    acceptance: "端到端用例通过",
  });
  g = changeGraph(g, { action: "node-status", nodeId: "a", status: "done" });
  const projectDoc = projectStateMarkdown(g),
    nodeDoc = nodeMemoryMarkdown(g, "a");
  assert.match(projectDoc, /前端 · 已完成/);
  assert.match(projectDoc, /前端模块完成登录展示/);
  assert.match(nodeDoc, /记忆主对话：root/);
  assert.match(nodeDoc, /端到端用例通过/);
});
test("editing a ready node goal makes its canonical memory stale", () => {
  let g = fixture();
  g = changeGraph(g, {
    action: "conversation-link",
    nodeId: "a",
    threadId: "root",
    kind: "memory",
  });
  g = changeGraph(g, {
    action: "memory-align",
    nodeId: "a",
    summary: "已确认",
  });
  g = changeGraph(g, { action: "node-edit", nodeId: "a", goal: "新的目标" });
  assert.equal(g.nodes[0].memory.status, "stale");
  assert.throws(
    () =>
      changeGraph(g, { action: "node-status", nodeId: "a", status: "done" }),
    /尚未对齐/,
  );
});
