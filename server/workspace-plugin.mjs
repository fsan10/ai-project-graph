import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { CodexClient } from "./codex-client.mjs";
import {
  emptyWorkspace,
  validateBlueprint,
  nodeContext,
  blueprintSchema,
  nodeReplySchema,
  applyNodeReply,
} from "./workspace-domain.mjs";

export function workspacePlugin() {
  const token = randomUUID();
  return {
    name: "local-codex-workspace",
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
      const directory = resolve(process.env.GRAPH_DATA_DIR || ".data");
      const file = resolve(directory, "workspace-v2.json");
      await mkdir(directory, { recursive: true });
      let state;
      try {
        state = JSON.parse(await readFile(file, "utf8"));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        state = emptyWorkspace(process.cwd());
      }
      state.conversations.forEach((c) => {
        if (c.running) c.error = "服务已重启，可继续发送消息";
        c.running = false;
        c.pendingRequest = undefined;
      });
      let saving = Promise.resolve();
      const save = () => {
        const data = JSON.stringify(state, null, 2);
        saving = saving.catch(() => {}).then(async () => {
          await writeFile(file + ".tmp", data);
          await rename(file + ".tmp", file);
        });
        saving.catch((e) => {
          state.error = `保存失败：${e.message}`;
        });
        return saving;
      };
      const jobs = new Map(),
        resumed = new Set();
      const client = new CodexClient(
        (event) => {
          const p = event.params || {};
          const c = state.conversations.find((c) => c.threadId === p.threadId);
          if (!c) return;
          if (
            event.id !== undefined &&
            [
              "item/commandExecution/requestApproval",
              "item/fileChange/requestApproval",
              "item/tool/requestUserInput",
            ].includes(event.method)
          ) {
            c.pendingRequest = {
              id: event.id,
              method: event.method,
              command: p.command,
              reason: p.reason,
              questions: p.questions,
            };
            save();
          }
          if (event.method === "item/agentMessage/delta") {
            let m = c.messages.find((m) => m.id === p.itemId);
            if (!m) {
              m = { id: p.itemId, role: "assistant", text: "" };
              c.messages.push(m);
            }
            m.text += p.delta;
          }
          if (
            event.method === "item/completed" &&
            p.item?.type === "agentMessage"
          ) {
            let m = c.messages.find((m) => m.id === p.item.id);
            if (!m) {
              m = { id: p.item.id, role: "assistant", text: "" };
              c.messages.push(m);
            }
            m.text = p.item.text;
          }
          if (event.method === "turn/started") c.turnId = p.turn.id;
          if (
            event.method === "item/started" &&
            ["commandExecution", "fileChange"].includes(p.item?.type)
          )
            c.messages.push({
              id: p.item.id,
              role: "tool",
              text: p.item.command || "正在修改文件…",
            });
          if (
            event.method === "item/completed" &&
            ["commandExecution", "fileChange"].includes(p.item?.type)
          ) {
            const m = c.messages.find((m) => m.id === p.item.id);
            if (m)
              m.text = `${p.item.command || "文件修改"}\n${p.item.aggregatedOutput || JSON.stringify(p.item.changes || [])}\n状态：${p.item.status}`;
          }
          if (event.method === "turn/completed") {
            c.running = false;
            c.pendingRequest = undefined;
            const job = jobs.get(c.id);
            jobs.delete(c.id);
            if (p.turn.status !== "completed")
              c.error =
                p.turn.error?.message ||
                `运行${p.turn.status === "interrupted" ? "已停止" : "失败"}`;
            else if (job) {
              try {
                const text =
                  c.messages.filter((m) => m.role === "assistant").at(-1)
                    ?.text || "";
                if (job === "blueprint") {
                  Object.assign(
                    state,
                    validateBlueprint(
                      JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")),
                    ),
                  );
                  state.phase = "review";
                  c.messages.filter((m) => m.role === "assistant").at(-1).text =
                    `架构草案已生成：${state.name}\n\n${state.consensus}\n\n${state.nodes.map((n) => `${n.title}：${n.goal}`).join("\n")}\n\n请查看架构图，确认后开始节点任务。`;
                }
                if (job === "node") {
                  const reply = JSON.parse(text);
                  c.messages.filter((m) => m.role === "assistant").at(-1).text =
                    applyNodeReply(
                      state.nodes.find((n) => n.id === c.nodeId),
                      reply,
                    );
                }
              } catch (e) {
                c.error = e.message;
              }
            }
            save();
          }
          if (event.method === "error")
            c.error = p.error?.message || "Codex 执行错误";
        },
        (error) => {
          resumed.clear();
          state.conversations.forEach((c) => {
            if (c.running) {
              c.running = false;
              c.error = error.message;
            }
            c.pendingRequest = undefined;
          });
          save();
        },
      );
      server.httpServer?.once("close", () => client.close());
      async function send(c, text, job) {
        if (c.running) throw new Error("当前对话正在运行，请等待或停止");
        c.running = true;
        c.error = undefined;
        try {
          await client.start();
          const node = state.nodes.find((n) => n.id === c.nodeId);
          const instructions = node
            ? nodeContext(state, node)
            : "你是项目规划伙伴。用中文在同一个对话里逐步澄清用户目标、范围、技术约束、架构与验收标准。未明确确认前只讨论，不实施，不修改文件。通过普通聊天提问，不调用 request_user_input。";
          if (!c.threadId) {
            const r = await client.call("thread/start", {
              cwd: state.cwd,
              sandbox: node ? "workspace-write" : "read-only",
              approvalPolicy: node ? "on-request" : "never",
              developerInstructions: instructions,
            });
            c.threadId = r.thread.id;
            resumed.add(c.threadId);
          } else if (!resumed.has(c.threadId)) {
            await client.call("thread/resume", { threadId: c.threadId });
            resumed.add(c.threadId);
          }
          if (node) job = "node";
          if (job) jobs.set(c.id, job);
          c.messages.push({ id: randomUUID(), role: "user", text });
          await save();
          const blocked =
            node &&
            state.nodes.some(
              (n) =>
                node.dependencies.includes(n.id) &&
                n.tasks.some((t) => t.status !== "done"),
            );
          const inputText = node
            ? `${text}\n\n当前节点上下文：${nodeContext(state, node)}\n${blocked ? "依赖尚未验收完成，本轮仅讨论与准备，不修改文件。" : ""}\n回复结构要求：reply 是给用户的回复；summary 是供下一段对话使用的最新事实交接（文件、接口、已验证结果、未完成项）；taskUpdates 只包含本节点任务 ID 与实际执行情况，没有执行就返回空数组。in_review 必须有验证证据，不能宣称用户已验收。`
            : text;
          const r = await client.call("turn/start", {
            threadId: c.threadId,
            input: [{ type: "text", text: inputText }],
            sandboxPolicy:
              node && !blocked
                ? {
                    type: "workspaceWrite",
                  writableRoots: [state.cwd],
                  networkAccess: false,
                  excludeTmpdirEnvVar: false,
                  excludeSlashTmp: false,
                }
              : { type: "readOnly", networkAccess: false },
            ...(job === "blueprint"
              ? { outputSchema: blueprintSchema }
              : node
                ? { outputSchema: nodeReplySchema }
                : {}),
          });
          c.turnId = r.turn.id;
        } catch (e) {
          c.running = false;
          c.error = e.message;
          jobs.delete(c.id);
          await save();
          throw e;
        }
      }
      let mutation = false;
      server.middlewares.use("/api/workspace", async (req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        if (req.headers["x-graph-token"] !== token) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "请从本地项目页面连接 Codex" }));
          return;
        }
        if (req.method === "GET") {
          res.end(JSON.stringify(state));
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("{}");
          return;
        }
        if (mutation) {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: "正在处理上一项操作" }));
          return;
        }
        mutation = true;
        try {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 100000) throw new Error("消息过长");
          }
          const p = JSON.parse(body);
          const c = state.conversations.find((c) => c.id === p.conversationId);
          if (p.action === "send") {
            if (!c || typeof p.text !== "string" || !p.text.trim())
              throw new Error("请输入消息");
            await send(c, p.text.trim());
          } else if (p.action === "blueprint") {
            if (state.phase === "execution")
              throw new Error("已确认的架构不能覆盖");
            const main = state.conversations[0];
            if (!main.messages.some((m) => m.role === "assistant"))
              throw new Error("请先与 Codex 沟通项目想法");
            await send(
              main,
              "请依据我们已经讨论的内容生成待确认的项目架构。包含全局共识、节点目标、职责提示词、无环依赖以及每个节点可验收的小任务。不要实施代码。",
              "blueprint",
            );
          } else if (p.action === "confirm") {
            if (
              state.phase !== "review" ||
              state.conversations.some((c) => c.running)
            )
              throw new Error("请先完成架构方案");
            state.phase = "execution";
          } else if (p.action === "respond") {
            if (!c?.pendingRequest || c.pendingRequest.id !== p.requestId)
              throw new Error("交互请求已过期");
            if (c.pendingRequest.method === "item/tool/requestUserInput") {
              const answers = {};
              for (const q of c.pendingRequest.questions) {
                if (
                  typeof p.answers?.[q.id] !== "string" ||
                  !p.answers[q.id].trim()
                )
                  throw new Error("请回答所有问题");
                answers[q.id] = { answers: [p.answers[q.id]] };
              }
              client.respond(p.requestId, { answers });
            } else {
              if (!["accept", "decline"].includes(p.decision))
                throw new Error("请选择允许或拒绝");
              client.respond(p.requestId, { decision: p.decision });
            }
            c.pendingRequest = undefined;
          } else if (p.action === "conversation") {
            if (
              state.phase !== "execution" ||
              !state.nodes.some((n) => n.id === p.nodeId)
            )
              throw new Error("请先确认架构");
            state.conversations.push({
              id: randomUUID(),
              nodeId: p.nodeId,
              title: `节点对话 ${state.conversations.filter((c) => c.nodeId === p.nodeId).length + 1}`,
              messages: [],
            });
          } else if (p.action === "stop") {
            if (!c?.running || !c.turnId) throw new Error("没有可停止的运行");
            await client.call("turn/interrupt", {
              threadId: c.threadId,
              turnId: c.turnId,
            });
          } else if (p.action === "handoff") {
            if (!c?.nodeId) throw new Error("请选择节点对话");
            await send(
              c,
              "请生成简洁的交接摘要：已完成内容、涉及文件、关键接口和决策、验证结果、未完成项。只总结已知事实，供该节点下一段新对话使用。",
              "handoff",
            );
          } else if (p.action === "task") {
            const task = state.nodes
              .flatMap((n) => n.tasks)
              .find((t) => t.id === p.taskId);
            if (
              !task ||
              !["todo", "in_progress", "in_review", "done"].includes(
                p.status,
              ) ||
              state.phase !== "execution"
            )
              throw new Error("任务更新无效");
            task.status = p.status;
          } else if (p.action === "cwd") {
            if (state.conversations.some((c) => c.threadId))
              throw new Error("开始对话后不能更换工作目录");
            const { stat } = await import("node:fs/promises");
            if (!(await stat(p.cwd)).isDirectory())
              throw new Error("工作目录不存在");
            state.cwd = resolve(p.cwd);
          } else throw new Error("不支持的操作");
          await save();
          res.end(JSON.stringify(state));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: e.message }));
        } finally {
          mutation = false;
        }
      });
    },
  };
}
