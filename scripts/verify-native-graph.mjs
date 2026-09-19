import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const directory = resolve("work", `native-verify-${Date.now()}`);
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
    env: {
      ...process.env,
      GRAPH_DATA_DIR: directory,
      GRAPH_DISABLE_PROJECT_MEMORY: "1",
    },
    windowsHide: true,
    stdio: "ignore",
  },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let runtime;
  for (let i = 0; i < 50; i++) {
    try {
      runtime = JSON.parse(
        await readFile(resolve(directory, "native-runtime.json"), "utf8"),
      );
      break;
    } catch {
      await sleep(200);
    }
  }
  assert.ok(runtime, "Test service startup");
  async function api(query = {}, body) {
    const r = await fetch(
      `${runtime.url}/api/native-graph?${new URLSearchParams(query)}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          "x-graph-token": runtime.token,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const value = await r.json();
    if (!r.ok) throw new Error(value.error);
    return value;
  }
  assert.equal((await fetch(runtime.url + "/api/native-graph")).status, 403);
  const { projects } = await api({ action: "projects" }),
    project = projects.find((p) =>
      p.roots.some(
        (r) => resolve(r).toLowerCase() === process.cwd().toLowerCase(),
      ),
    );
  assert.ok(project);
  const projectId = project.id;
  let state = await api({ projectId });
  assert.equal(state.graph.nodes.length, 0);
  assert.ok(state.threads.length);
  console.log("PASS real native projects and project-scoped thread catalog");
  const spec = {
    name: "隔离验证",
    document: "# 验证专用开发文档",
    nodes: [
      { id: "canvas", title: "画布", goal: "自由拖动", tasks: ["持久化坐标"] },
      {
        id: "native",
        title: "原生对话",
        goal: "正确归类",
        tasks: ["返回原生历史"],
      },
    ],
    edges: [{ source: "canvas", target: "native", label: "关联" }],
  };
  await assert.rejects(
    api({}, { action: "publish", projectId, spec, confirmed: false }),
    /确认/,
  );
  await api({}, { action: "publish", projectId, spec, confirmed: true });
  const nativeId = state.threads[0].id;
  await api(
    {},
    { action: "assign", projectId, nodeId: "native", threadId: nativeId },
  );
  await api(
    {},
    {
      action: "layout",
      projectId,
      positions: [{ id: "native", x: -360, y: 580 }],
    },
  );
  state = await api({ projectId });
  assert.equal(state.graph.nodes[1].x, -360);
  assert.deepEqual(state.graph.nodes[1].threadIds, [nativeId]);
  const stored = JSON.parse(
    await readFile(resolve(directory, "native", `${projectId}.json`), "utf8"),
  );
  assert.equal(stored.nodes[1].y, 580);
  console.log(
    "PASS confirmation gate, native thread assignment and durable drag layout",
  );
  const foreign = projects.find((p) => p.id !== projectId);
  await assert.rejects(
    api(
      {},
      {
        action: "assign",
        projectId: foreign.id,
        nodeId: "missing",
        threadId: nativeId,
      },
    ),
    /不属于/,
  );
  const search = await api({
    projectId,
    action: "search",
    q: nativeId,
    history: "false",
  });
  assert.equal(search.threads[0].id, nativeId);
  const prepared = await api(
    {},
    { action: "prepare", projectId, nodeId: "native" },
  );
  assert.match(prepared.instruction, /\$project-graph/);
  assert.match(prepared.instruction, /--role memory/);
  assert.equal(prepared.mode, "new");
  console.log(
    "PASS project search isolation and read-only memory composer instruction",
  );
  if (process.env.CODEX_THREAD_ID) {
    execFileSync(
      process.execPath,
      [
        "scripts/graphctl.mjs",
        "register",
        "--project",
        projectId,
        "--node",
        "canvas",
      ],
      {
        env: {
          ...process.env,
          GRAPH_RUNTIME: resolve(directory, "native-runtime.json"),
        },
        stdio: "pipe",
      },
    );
    state = await api({ projectId });
    assert.ok(
      state.graph.nodes[0].threadIds.includes(process.env.CODEX_THREAD_ID),
    );
    console.log("PASS Skill CLI automatically registers real CODEX_THREAD_ID");
  }
  await writeFile(
    resolve(directory, "verification.json"),
    JSON.stringify({ projectId, nativeId, verified: true }),
  );
  console.log(`Artifacts: ${directory}`);
} finally {
  child.kill();
}
