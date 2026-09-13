import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  validateBlueprint,
  nodeContext,
  applyNodeReply,
} from "../server/workspace-domain.mjs";
const blueprint = () => ({
  name: "测试项目",
  consensus: "只实现明确范围",
  nodes: [
    {
      id: "api",
      title: "接口",
      goal: "实现接口",
      prompt: "验证接口",
      dependencies: [],
      tasks: ["返回正确响应"],
    },
    {
      id: "ui",
      title: "页面",
      goal: "呈现数据",
      prompt: "实现页面",
      dependencies: ["api"],
      tasks: ["展示返回结果"],
    },
  ],
});
test("new workspace starts with one empty main chat and no seeded graph", () => {
  const s = emptyWorkspace("/repo");
  assert.equal(s.phase, "planning");
  assert.deepEqual(s.nodes, []);
  assert.equal(s.conversations.length, 1);
  assert.deepEqual(s.conversations[0].messages, []);
  assert.equal(s.conversations[0].threadId, undefined);
});
test("AI task reports require evidence, cannot accept tasks, and cannot mutate other nodes", () => {
  const node = validateBlueprint(blueprint()).nodes[0];
  const report = {
    reply: "测试通过",
    summary: "接口已验证",
    taskUpdates: [
      { id: "api-0", status: "in_review", evidence: "GET /api 返回 200" },
    ],
  };
  applyNodeReply(node, report);
  assert.equal(node.tasks[0].status, "in_review");
  assert.throws(() =>
    applyNodeReply(node, {
      ...report,
      taskUpdates: [{ ...report.taskUpdates[0], status: "done" }],
    }),
  );
  assert.throws(() =>
    applyNodeReply(node, {
      ...report,
      taskUpdates: [{ ...report.taskUpdates[0], id: "ui-0" }],
    }),
  );
  assert.throws(() =>
    applyNodeReply(node, {
      ...report,
      taskUpdates: [{ ...report.taskUpdates[0], evidence: "" }],
    }),
  );
  node.tasks[0].status = "done";
  applyNodeReply(node, report);
  assert.equal(node.tasks[0].status, "done");
});
test("blueprint generates unique pending tasks and preserves dependency direction", () => {
  const s = validateBlueprint(blueprint());
  assert.equal(s.nodes[1].dependencies[0], "api");
  assert.equal(s.nodes[0].tasks[0].status, "todo");
  assert.notEqual(s.nodes[0].tasks[0].id, s.nodes[1].tasks[0].id);
});
test("rejects missing dependencies, duplicates and dependency cycles", () => {
  let b = blueprint();
  b.nodes[0].dependencies = ["missing"];
  assert.throws(() => validateBlueprint(b));
  b = blueprint();
  b.nodes[0].dependencies = ["ui"];
  assert.throws(() => validateBlueprint(b), /循环/);
  b = blueprint();
  b.nodes[1].id = "api";
  assert.throws(() => validateBlueprint(b));
});
test("new node context includes targeted handoff but excludes unrelated chat history", () => {
  const s = { ...emptyWorkspace("/repo"), ...validateBlueprint(blueprint()) };
  s.nodes[0].summary = "接口路径 /api/list";
  s.conversations[0].messages.push({ text: "PRIVATE_CHAT_HISTORY" });
  const context = nodeContext(s, s.nodes[1]);
  assert.match(context, /api\/list/);
  assert.match(context, /呈现数据/);
  assert.doesNotMatch(context, /PRIVATE_CHAT_HISTORY/);
});
