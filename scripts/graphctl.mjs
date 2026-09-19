import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2),
  command = args[0] || "status";
function option(name) {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
}
const runtimePath =
  process.env.GRAPH_RUNTIME ||
  fileURLToPath(new URL("../.data/native-runtime.json", import.meta.url));
let runtime;
try {
  runtime = JSON.parse(await readFile(runtimePath, "utf8"));
} catch {
  throw new Error(
    "项目图谱服务尚未启动。请在 ai-project-graph 仓库运行 npm run codex 或 npm start。",
  );
}
async function request(params, body) {
  const response = await fetch(
    `${runtime.url}/api/native-graph?${new URLSearchParams(params)}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        "x-graph-token": runtime.token,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
}
const { projects } = await request({ action: "projects" });
if (command === "projects") {
  console.log(JSON.stringify(projects, null, 2));
  process.exit(0);
}
const normalize = (p) => resolve(p).toLowerCase();
const project =
  projects.find((p) => p.id === option("project")) ||
  (!option("project") &&
    projects.find((p) =>
      p.roots.some((r) => normalize(r) === normalize(process.cwd())),
    ));
if (!project)
  throw new Error(
    "当前目录未匹配 Codex 已有项目。请用 graphctl projects 查看并传入 --project 项目ID。不要创建重复项目。",
  );
const projectId = project.id,
  nodeId = option("node"),
  threadId = process.env.CODEX_THREAD_ID;
let result;
if (command === "status") result = await request({ projectId });
else if (command === "context") {
  if (!nodeId) throw new Error("缺少 --node");
  result = await request({ action: "context", projectId, nodeId });
} else if (command === "register") {
  if (!threadId)
    throw new Error(
      "当前进程没有 CODEX_THREAD_ID；请在原生 Codex 对话中执行。",
    );
  if (!nodeId) throw new Error("缺少 --node");
  result = await request(
    {},
    {
      action: "register",
      projectId,
      nodeId,
      threadId,
      role: option("role") || "imported",
    },
  );
} else if (command === "align") {
  if (!threadId || !nodeId || !option("file"))
    throw new Error("align 需要当前节点记忆主对话、--node 和 --file");
  const aligned = JSON.parse(await readFile(resolve(option("file")), "utf8"));
  result = await request(
    {},
    { action: "align", projectId, nodeId, threadId, ...aligned },
  );
} else if (command === "publish") {
  if (!args.includes("--confirmed"))
    throw new Error("用户明确确认开发文档后才能传入 --confirmed 发布图谱。");
  if (!option("file")) throw new Error("缺少 --file");
  const spec = JSON.parse(await readFile(resolve(option("file")), "utf8"));
  result = await request(
    {},
    { action: "publish", projectId, spec, confirmed: true, threadId },
  );
} else if (command === "report") {
  if (!threadId || !nodeId || !option("file"))
    throw new Error("report 需要当前原生线程、--node 和 --file");
  const report = JSON.parse(await readFile(resolve(option("file")), "utf8"));
  result = await request(
    {},
    { action: "report", projectId, nodeId, threadId, ...report },
  );
} else
  throw new Error(
    "支持：projects、status、context、register、align、publish、report",
  );
console.log(JSON.stringify(result, null, 2));
