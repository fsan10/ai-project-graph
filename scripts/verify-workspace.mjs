import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const directory = resolve("work", `verify-${Date.now()}`);
await mkdir(directory, { recursive: true });
const child = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--config",
    "vite.local.config.mjs",
    "--port",
    "5174",
  ],
  {
    env: { ...process.env, GRAPH_DATA_DIR: directory },
    windowsHide: true,
    stdio: "ignore",
  },
);
const base = "http://127.0.0.1:5174";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let html;
  for (let i = 0; i < 40; i++) {
    try {
      html = await (await fetch(base)).text();
      break;
    } catch {
      await sleep(250);
    }
  }
  const token = html.match(/window\.__GRAPH_TOKEN__="([^"]+)"/)[1];
  async function api(body) {
    const r = await fetch(base + "/api/workspace", {
      method: body ? "POST" : "GET",
      headers: { "x-graph-token": token, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  async function idle(id) {
    for (let i = 0; i < 180; i++) {
      const s = await api();
      const c = s.conversations.find((c) => c.id === id);
      if (!c.running) {
        if (c.error) throw new Error(c.error);
        return s;
      }
      await sleep(1000);
    }
    throw new Error("Turn timeout");
  }
  assert.equal((await fetch(base + "/api/workspace")).status, 403);
  assert.equal((await api()).nodes.length, 0);
  await api({ action: "cwd", cwd: directory });
  await api({
    action: "send",
    conversationId: "main",
    text: "这是集成验证项目，只规划不执行。我要做一个本地纯前端计数器，只有加一和重置按钮，无后端，无登录。架构分成计数逻辑和界面两个节点，每节点一个验收任务。技术选原生 JavaScript，范围已确认。请简短总结，不用提问，不读取文件。",
  });
  let s = await idle("main");
  assert.ok(s.conversations[0].threadId);
  console.log("PASS real planning conversation, automatic thread ownership");
  await api({ action: "blueprint" });
  s = await idle("main");
  assert.equal(s.phase, "review");
  assert.ok(s.nodes.length);
  console.log("PASS real structured architecture generation");
  await api({ action: "confirm" });
  s = await api({ action: "conversation", nodeId: s.nodes[0].id });
  const id = s.conversations.at(-1).id;
  await api({
    action: "send",
    conversationId: id,
    text: "只用一句话说明本节点目标，保存交接摘要。不执行任务，不读写文件，taskUpdates 返回空数组。",
  });
  s = await idle(id);
  assert.ok(s.nodes[0].summary);
  assert.notEqual(s.conversations[0].threadId, s.conversations.at(-1).threadId);
  console.log("PASS isolated node conversation and persisted handoff");
  console.log("Verification data:", directory);
} finally {
  child.kill();
}
