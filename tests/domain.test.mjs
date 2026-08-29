import assert from "node:assert/strict";
import test from "node:test";

import {
  DomainError,
  acceptNode,
  addEvidence,
  bindConversation,
  compileContext,
  confirmBlueprint,
  createEdge,
  createNode,
  createProject,
  createSeedState,
  moveNode,
  projectSnapshot,
  updateNodeLayout,
  validateGraph,
} from "../lib/domain.ts";

test("seed graph satisfies all hard validation constraints", () => {
  const diagnostics = validateGraph(createSeedState());
  assert.deepEqual(diagnostics.filter((item) => item.severity === "error"), []);
});

test("stable node IDs are unique, immutable identifiers", () => {
  const state = createSeedState();
  assert.throws(
    () => createNode(state, { id: "auth.login", name: "重复登录", type: "feature" }, state.revision),
    (error) => error instanceof DomainError && error.code === "DUPLICATE_NODE_ID",
  );
  assert.throws(
    () => createNode(state, { id: "Invalid ID", name: "非法节点", type: "feature" }, state.revision),
    (error) => error instanceof DomainError && error.code === "INVALID_STABLE_ID",
  );
});

test("optimistic revision rejects stale conversation writes", () => {
  const state = createSeedState();
  assert.throws(
    () => moveNode(state, "auth.token", "in_progress", state.revision - 1),
    (error) => error instanceof DomainError && error.code === "VERSION_CONFLICT",
  );
});

test("an agent can submit review but cannot mark Done", () => {
  const state = createSeedState();
  const review = moveNode(state, "auth.token", "in_review", state.revision, "agent");
  assert.equal(review.nodes.find((node) => node.id === "auth.token").status, "in_review");
  assert.throws(
    () => moveNode(review, "auth.token", "done", review.revision, "agent"),
    (error) => error instanceof DomainError && error.code === "AGENT_CANNOT_COMPLETE",
  );
});

test("human acceptance creates a checkpoint and updates Project State", () => {
  const state = createSeedState();
  const accepted = acceptNode(state, "auth.login", state.revision, {
    summary: "登录验收通过",
    acceptedBy: "Napoleon",
  });
  assert.equal(accepted.nodes.find((node) => node.id === "auth.login").status, "done");
  const checkpoint = accepted.checkpoints.find((item) => item.nodeId === "auth.login");
  assert.equal(checkpoint.summary, "登录验收通过");
  assert.equal(checkpoint.acceptedBy, "Napoleon");
  assert(projectSnapshot(accepted).completedNodes.includes("auth.login"));
});

test("Context Compiler includes direct dependency checkpoint but excludes unrelated chat details", () => {
  const state = createSeedState();
  const withDependency = createEdge(state, "database", "auth.login", "depends_on", state.revision);
  const context = compileContext(withDependency, "auth.login", "thr_auth_login_12");
  assert.equal(context.dependencies[0].id, "database");
  assert.equal(context.dependencies[0].checkpoint.summary.includes("用户与权限"), true);
  assert.equal(context.currentThread.threadId, "thr_auth_login_12");
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("用户权限 Schema"), false);
});

test("full Codex conversation binding is retained on the node", () => {
  const state = createSeedState();
  const next = bindConversation(state, "auth.permission", {
    title: "实现 RBAC",
    threadId: "thr_rbac_99",
    codexProjectId: "admin-console",
    codexProjectKind: "workspace",
    codexHostId: "windows-desktop",
    workspacePath: "D:/projects/admin-console",
    summary: "RBAC 实现会话",
  }, state.revision);
  const binding = next.conversations.find((item) => item.threadId === "thr_rbac_99");
  assert.deepEqual(
    [binding.nodeId, binding.codexProjectId, binding.codexHostId, binding.workspacePath],
    ["auth.permission", "admin-console", "windows-desktop", "D:/projects/admin-console"],
  );
});

test("repository evidence verification fails closed", () => {
  const state = createSeedState();
  const invalid = addEvidence(state, "auth.token", {
    path: "../outside.ts",
    startLine: 9,
    endLine: 2,
    commitSha: "abc123",
  }, state.revision);
  const evidence = invalid.evidence.at(-1);
  assert.equal(evidence.verificationStatus, "invalid");
  assert.equal(invalid.nodes.find((node) => node.id === "auth.token").evidenceStatus, "invalid");
  assert(validateGraph(invalid).some((item) => item.code === "UNKNOWN_SOURCE"));
});

test("manual layout is persisted without changing stable identity", () => {
  const state = createSeedState();
  const next = updateNodeLayout(state, "auth.login", 777.4, 222.6, state.revision);
  const node = next.nodes.find((item) => item.id === "auth.login");
  assert.equal(node.stableKey, "auth.login");
  assert.equal(node.layoutMode, "manual");
  assert.deepEqual([node.x, node.y], [777, 223]);
});

test("new project creates Architect, Blueprint Draft, graph hierarchy and stable IDs", () => {
  const state = createProject({
    name: "经营分析平台",
    goal: "汇总多平台经营数据",
    workspacePath: "D:/analytics",
    repositoryUrl: "https://github.com/example/analytics",
    mode: "greenfield",
    modules: ["订单 ETL", "经营看板"],
  });
  assert.equal(state.blueprint.status, "draft");
  assert.equal(state.conversations[0].type, "architect");
  assert.equal(state.nodes.length, 3);
  assert.equal(new Set(state.nodes.map((node) => node.stableKey)).size, 3);
  assert.deepEqual(validateGraph(state).filter((item) => item.severity === "error"), []);
  assert.equal(state.edges.every((edge) => edge.type === "contains"), true);
});

test("Blueprint confirmation creates a new graph version", () => {
  const state = createProject({
    name: "测试项目",
    goal: "验证 Blueprint",
    workspacePath: "",
    repositoryUrl: "",
    mode: "hybrid",
  });
  const next = confirmBlueprint(state, { ...state.blueprint, techStack: ["React", "Node.js"] }, state.revision);
  assert.equal(next.blueprint.status, "confirmed");
  assert.equal(next.graphVersion, state.graphVersion + 1);
  assert.equal(next.revision, state.revision + 1);
});
