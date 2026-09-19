import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { CodexClient } from "./codex-client.mjs";
import { nativeCatalog, belongsToProject } from "./native-catalog.mjs";
import {
  graphFor,
  changeGraph,
  publishGraph,
  contextForNode,
  normalizeGraph,
  projectStateMarkdown,
  nodeMemoryMarkdown,
  memoryFileName,
} from "./native-graph-domain.mjs";

export function nativeGraphPlugin() {
  const token = randomUUID(),
    directory = resolve(process.env.GRAPH_DATA_DIR || ".data", "native");
  const graphs = new Map(),
    lists = new Map();
  let writeQueue = Promise.resolve();
  const client = new CodexClient(
    () => {},
    () => {
      lists.clear();
    },
  );
  async function rpc(method, params) {
    await client.start();
    return client.call(method, params);
  }
  async function graph(project) {
    if (graphs.has(project.id)) return graphs.get(project.id);
    let value;
    try {
      value = JSON.parse(
        await readFile(
          join(directory, `${encodeURIComponent(project.id)}.json`),
          "utf8",
        ),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      value = graphFor(project);
    }
    const version = value.version;
    value = normalizeGraph(value);
    graphs.set(project.id, value);
    if (version !== value.version) await store(value, project);
    return value;
  }
  const memoryPaths = (project, nodeId) => {
    const root = resolve(
      process.env.GRAPH_PROJECT_MEMORY_ROOT || project.path,
      ".codex",
      "project-graph",
    );
    return {
      root,
      project: join(root, "project-status.md"),
      node: nodeId ? join(root, "nodes", memoryFileName(nodeId)) : null,
    };
  };
  async function atomicWrite(path, data) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, "utf8");
    await rename(temporary, path);
  }
  async function writeProjectMemory(project, value, previous) {
    if (process.env.GRAPH_DISABLE_PROJECT_MEMORY === "1") return;
    const paths = memoryPaths(project);
    const projectDocument = projectStateMarkdown(value);
    if (
      !previous ||
      projectStateMarkdown(previous) !== projectDocument
    )
      await atomicWrite(paths.project, projectDocument);
    for (const node of value.nodes) {
      const nodePath = memoryPaths(project, node.id).node;
      const nodeDocument = nodeMemoryMarkdown(value, node.id);
      if (
        !previous?.nodes.some((item) => item.id === node.id) ||
        nodeMemoryMarkdown(previous, node.id) !== nodeDocument
      )
        await atomicWrite(nodePath, nodeDocument);
    }
    for (const oldNode of previous?.nodes || []) {
      if (value.nodes.some((node) => node.id === oldNode.id)) continue;
      try {
        await unlink(memoryPaths(project, oldNode.id).node);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  async function store(value, project) {
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${encodeURIComponent(value.projectId)}.json`),
      data = JSON.stringify(value, null, 2);
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        const previous = graphs.get(value.projectId);
        await writeFile(path + ".tmp", data);
        await rename(path + ".tmp", path);
        if (project) await writeProjectMemory(project, value, previous);
        graphs.set(value.projectId, value);
      });
    await writeQueue;
    return value;
  }
  async function threads(project, catalog, refresh = false) {
    const cached = lists.get(project.id);
    if (!refresh && cached && Date.now() - cached.at < 8000) return cached.data;
    const data = [];
    let cursor = null;
    do {
      const result = await rpc("thread/list", {
        cwd: project.roots,
        limit: 100,
        cursor,
        sortKey: "updated_at",
        sourceKinds: ["cli", "vscode", "appServer"],
        useStateDbOnly: true,
      });
      data.push(
        ...result.data.filter((t) => belongsToProject(t, project, catalog)),
      );
      cursor = result.nextCursor;
    } while (cursor);
    // Native project membership can include worktrees outside the primary cwd.
    const known = new Set(data.map((t) => t.id));
    const assigned = Object.entries(catalog.assignments)
      .filter(
        ([id, a]) =>
          !known.has(id) &&
          [project.id, project.canonicalId].includes(
            typeof a === "string" ? a : a?.projectId,
          ),
      )
      .map(([id]) => id);
    let offset = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, assigned.length) }, async () => {
        while (offset < assigned.length) {
          const id = assigned[offset++];
          try {
            const { thread } = await rpc("thread/read", {
              threadId: id,
              includeTurns: false,
            });
            if (belongsToProject(thread, project, catalog)) data.push(thread);
          } catch {
            /* Native deleted/unavailable threads stay out of the live catalog. */
          }
        }
      }),
    );
    data.sort((a, b) => b.updatedAt - a.updatedAt);
    lists.set(project.id, { at: Date.now(), data });
    return data;
  }
  const publicThread = (t) => ({
    id: t.id,
    title: t.name || t.preview?.split("\n")[0]?.slice(0, 100) || "未命名对话",
    preview: t.preview || "",
    updatedAt: t.updatedAt,
    status: t.status?.type || "unknown",
  });
  async function verifiedThread(id, project, catalog, history = false) {
    const { thread } = await rpc("thread/read", {
      threadId: id,
      includeTurns: history,
    });
    if (!belongsToProject(thread, project, catalog))
      throw new Error("该对话不属于当前 Codex 项目");
    return thread;
  }
  return {
    name: "native-project-graph",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          children: `window.__GRAPH_TOKEN__=${JSON.stringify(token)}`,
          injectTo: "head",
        },
      ];
    },
    async configureServer(server) {
      await mkdir(directory, { recursive: true });
      server.httpServer?.once("listening", async () => {
        const address = server.httpServer.address();
        await writeFile(
          resolve(process.env.GRAPH_DATA_DIR || ".data", "native-runtime.json"),
          JSON.stringify({ url: `http://127.0.0.1:${address.port}`, token }),
        );
      });
      server.httpServer?.once("close", () => client.close());
      let mutation = Promise.resolve();
      // Embedded documents must use ordinary stylesheet links, not Vite's
      // style-injecting module cache, which survives setDocumentContent.
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url, "http://localhost");
        const pathname = requestUrl.pathname;
        const embeddedHtml =
          pathname === "/codex-native.html" ||
          (pathname === "/index.html" &&
            requestUrl.searchParams.get("host") === "codex");
        if (!embeddedHtml && !pathname.startsWith("/graph-assets/"))
          return next();
        try {
          res.setHeader("cache-control", "no-store");
          if (embeddedHtml) {
            const html = (
              await readFile(resolve("dist-local/index.html"), "utf8")
            )
              .replace(
                /window\.__GRAPH_TOKEN__\s*=\s*"[^"]+"/,
                `window.__GRAPH_TOKEN__=${JSON.stringify(token)}`,
              )
              .replaceAll("/assets/", "/graph-assets/");
            res.setHeader("content-type", "text/html; charset=utf-8");
            res.end(html);
          } else {
            const name = pathname.slice("/graph-assets/".length);
            if (!/^[\w.-]+\.(js|css)$/.test(name)) {
              res.statusCode = 404;
              res.end();
              return;
            }
            res.setHeader(
              "content-type",
              name.endsWith(".css") ? "text/css" : "text/javascript",
            );
            res.end(await readFile(resolve("dist-local/assets", name)));
          }
        } catch {
          res.statusCode = 503;
          res.end("请先运行 npm run build");
        }
      });
      server.middlewares.use("/api/native-graph", async (req, res) => {
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        if (req.headers["x-graph-token"] !== token) {
          res.statusCode = 403;
          res.end(
            JSON.stringify({ error: "请重新打开项目图谱以连接本地服务" }),
          );
          return;
        }
        async function handle() {
          const catalog = await nativeCatalog();
          if (req.method === "GET") {
            const url = new URL(req.url, "http://localhost"),
              action = url.searchParams.get("action");
            if (action === "projects")
              return {
                projects: catalog.projects,
                selectedProjectId: catalog.selectedProjectId,
              };
            const project = catalog.projects.find(
              (p) => p.id === url.searchParams.get("projectId"),
            );
            if (!project) throw new Error("请选择 Codex 已有项目");
            const g = await graph(project);
            if (action === "context") {
              const nodeId = url.searchParams.get("nodeId");
              return {
                ...contextForNode(g, nodeId),
                files: {
                  projectStatus: memoryPaths(project).project,
                  nodeMemory: memoryPaths(project, nodeId).node,
                },
              };
            }
            if (action === "thread")
              return {
                thread: publicThread(
                  await verifiedThread(
                    url.searchParams.get("threadId"),
                    project,
                    catalog,
                  ),
                ),
              };
            const all = await threads(
              project,
              catalog,
              url.searchParams.get("refresh") === "true",
            );
            if (action === "search") {
              const query = (url.searchParams.get("q") || "")
                .trim()
                .toLowerCase();
              if (!query) return { threads: all.map(publicThread) };
              const results = [];
              let index = 0;
              const failures = [];
              await Promise.all(
                Array.from({ length: Math.min(4, all.length) }, async () => {
                  while (index < all.length) {
                    const t = all[index++],
                      meta = publicThread(t);
                    if (
                      `${meta.title} ${t.id} ${t.preview}`
                        .toLowerCase()
                        .includes(query)
                    ) {
                      results.push(meta);
                      continue;
                    }
                    if (url.searchParams.get("history") !== "true") continue;
                    try {
                      const full = await verifiedThread(
                        t.id,
                        project,
                        catalog,
                        true,
                      );
                      const text = full.turns
                        .flatMap((turn) => turn.items)
                        .flatMap(
                          (item) =>
                            item.text ||
                            item.content
                              ?.filter((c) => c.type === "text")
                              .map((c) => c.text) ||
                            [],
                        )
                        .join("\n");
                      const at = text.toLowerCase().indexOf(query);
                      if (at >= 0)
                        results.push({
                          ...meta,
                          snippet: text.slice(Math.max(0, at - 50), at + 150),
                        });
                    } catch {
                      failures.push(t.id);
                    }
                  }
                }),
              );
              return {
                threads: results.sort((a, b) => b.updatedAt - a.updatedAt),
                unavailable: failures,
              };
            }
            return { graph: g, threads: all.map(publicThread) };
          }
          if (req.method !== "POST") throw new Error("不支持的请求");
          let raw = "";
          for await (const c of req) {
            raw += c;
            if (raw.length > 2_000_000) throw new Error("请求过大");
          }
          const p = JSON.parse(raw);
          const project = catalog.projects.find((x) => x.id === p.projectId);
          if (!project) throw new Error("请选择 Codex 已有项目");
          const g = await graph(project);
          if (p.action === "prepare") {
            const node = p.nodeId
              ? g.nodes.find((n) => n.id === p.nodeId)
              : null;
            if (p.nodeId && !node) throw new Error("节点不存在");
            if (node?.rootThreadId)
              return {
                project,
                mode: "open",
                threadId: node.rootThreadId,
              };
            const instruction = node
              ? `$project-graph\n这是「${node.title}」节点的记忆主对话。先运行 graphctl register --project ${project.id} --node ${node.id} --role memory，再运行 context。\n当前阶段只做需求与颗粒度对齐：只能回答、提问、澄清和总结，不得修改项目文件，不得执行实现命令。\n节点目标：${node.goal || node.title}\n节点职责：${node.prompt || "待共同补充"}\n请结合项目开发文档、项目状态和直接依赖，与我持续对齐范围、接口、约束、验收边界和非目标。只有我明确确认节点核心记忆后，才用 graphctl align 保存总结。未来工作对话会从本对话原生分支，并继承这段完整历史。`
              : `$project-graph\n我想在当前 Codex 项目中规划一个项目。请先和我沟通需求、范围、架构、风险、里程碑与验收标准，形成详细开发文档。只有我明确确认文档后，才发布架构图。当前项目：${project.name}（${project.id}）。`;
            return { project, mode: "new", instruction };
          }
          if (p.action === "fork") {
            const node = g.nodes.find((item) => item.id === p.nodeId);
            if (!node?.rootThreadId) throw new Error("请先创建节点记忆主对话");
            if (node.memory.status !== "ready")
              throw new Error("请先在记忆主对话中完成颗粒度对齐");
            const root = await verifiedThread(
              node.rootThreadId,
              project,
              catalog,
            );
            if (root.status?.type === "active")
              throw new Error("记忆主对话仍在运行，请等待当前回复结束后再分支");
            const result = await rpc("thread/fork", {
              threadId: node.rootThreadId,
            });
            const threadId = result.thread.id;
            const files = memoryPaths(project, node.id);
            let reminderInjected = false;
            try {
              await rpc("thread/inject_items", {
                threadId,
                items: [
                  {
                    type: "message",
                    role: "assistant",
                    content: [
                      {
                        type: "output_text",
                        text: `本工作分支已从「${node.title}」记忆主线原生派生，完整对齐历史已经继承。开始当前工作前读取最新项目状态：${files.project}；只有需要核对稳定边界时再读取节点记忆：${files.node}。不要重复发送节点记忆，也不要重新扫描整个项目。`,
                      },
                    ],
                  },
                ],
              });
              reminderInjected = true;
            } catch {
              // The inherited memory remains valid if an older Codex lacks item injection.
            }
            const updated = changeGraph(g, {
              action: "conversation-link",
              nodeId: node.id,
              threadId,
              kind: "branch",
              parentThreadId: node.rootThreadId,
            });
            if (
              updated.nodes.find((item) => item.id === node.id).status ===
              "ready"
            )
              updated.nodes.find((item) => item.id === node.id).status =
                "in_progress";
            try {
              await rpc("thread/name/set", {
                threadId,
                name: `${node.title} · 工作分支 ${node.conversations.filter((item) => item.kind === "branch").length + 1}`,
              });
            } catch {
              // Older Codex versions can still fork even if custom names are unavailable.
            }
            lists.clear();
            return {
              graph: await store(updated, project),
              thread: publicThread(result.thread),
              reminderInjected,
            };
          }
          if (p.action === "register" || p.action === "assign") {
            await verifiedThread(p.threadId, project, catalog);
            const action =
              p.action === "register" && p.role === "memory"
                ? {
                    action: "conversation-link",
                    nodeId: p.nodeId,
                    threadId: p.threadId,
                    kind: "memory",
                  }
                : { ...p, action: "assign" };
            const updated = changeGraph(g, action);
            if (p.role === "memory") {
              const node = updated.nodes.find((item) => item.id === p.nodeId);
              try {
                await rpc("thread/name/set", {
                  threadId: p.threadId,
                  name: `${node.title} · 节点记忆`,
                });
              } catch {
                // Naming is helpful metadata, not required for registration.
              }
            }
            return {
              graph: await store(updated, project),
            };
          }
          if (p.action === "align") {
            const node = g.nodes.find((item) => item.id === p.nodeId);
            if (!node || node.rootThreadId !== p.threadId)
              throw new Error("只有节点记忆主对话可以确认核心记忆");
            return {
              graph: await store(
                changeGraph(g, { ...p, action: "memory-align" }),
                project,
              ),
            };
          }
          if (p.action === "publish") {
            const updated = publishGraph(g, p.spec, p.confirmed);
            // An explicit invocation's planning thread is recorded without inventing a node category.
            if (p.threadId) {
              await verifiedThread(p.threadId, project, catalog);
              updated.planningThreadId = p.threadId;
            }
            await store(updated, project);
            return { graph: updated };
          }
          if (p.action === "report") {
            const node = g.nodes.find((n) => n.id === p.nodeId);
            if (!node || !node.threadIds.includes(p.threadId))
              throw new Error("请先自动登记当前节点对话");
            const next = structuredClone(g);
            const target = next.nodes.find((n) => n.id === p.nodeId);
            if (typeof p.summary === "string")
              target.summary = p.summary.slice(0, 20000);
            for (const update of p.tasks || []) {
              const task = target.tasks.find((t) => t.id === update.id);
              if (
                !task ||
                !["in_progress", "in_review"].includes(update.status) ||
                !update.evidence
              )
                throw new Error("任务报告无效");
              if (task.status !== "done") {
                task.status = update.status;
                task.evidence = String(update.evidence);
              }
            }
            if (target.status !== "done") {
              target.status = target.tasks.some(
                (task) => task.status === "in_review",
              )
                ? "in_review"
                : "in_progress";
            }
            next.revision++;
            next.updatedAt = new Date().toISOString();
            return { graph: await store(next, project) };
          }
          return { graph: await store(changeGraph(g, p), project) };
        }
        try {
          let result;
          if (req.method === "POST") {
            const pending = mutation.catch(() => {}).then(handle);
            mutation = pending;
            result = await pending;
          } else result = await handle();
          res.end(JSON.stringify(result));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}
