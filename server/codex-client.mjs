import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
export class CodexClient {
  constructor(onEvent, onFailure) {
    this.onEvent = onEvent;
    this.onFailure = onFailure;
    this.pending = new Map();
    this.sequence = 0;
  }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.connect();
    try {
      await this.ready;
    } catch (e) {
      this.ready = null;
      throw e;
    }
  }
  async connect() {
    this.child = spawn(
      process.env.CODEX_BIN || "codex",
      ["app-server", "--stdio"],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const fail = (error) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.pending.clear();
      this.ready = null;
      this.onFailure(error);
    };
    this.child.on("error", fail);
    this.child.on("exit", (code) =>
      fail(new Error(`Codex 服务已退出 (${code})`)),
    );
    this.child.stderr.on("data", () => {});
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.method) {
        if (
          event.id !== undefined &&
          ![
            "item/commandExecution/requestApproval",
            "item/fileChange/requestApproval",
            "item/tool/requestUserInput",
          ].includes(event.method)
        ) {
          // Unsupported interactive requests fail closed; never silently approve commands.
          this.child.stdin.write(
            JSON.stringify({
              id: event.id,
              error: {
                code: -32601,
                message: "此客户端暂不支持该交互请求，请在聊天中继续说明。",
              },
            }) + "\n",
          );
        }
        this.onEvent(event);
        return;
      }
      const p = this.pending.get(event.id);
      if (!p) return;
      this.pending.delete(event.id);
      clearTimeout(p.timer);
      if (event.error) p.reject(new Error(event.error.message));
      else p.resolve(event.result);
    });
    await this.call("initialize", {
      clientInfo: {
        name: "ai_project_graph",
        title: "AI 项目图谱",
        version: "0.2.0",
      },
    });
    this.child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
  }
  call(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex 请求超时：${method}`));
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ id, method, params }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }
  close() {
    this.child?.kill();
  }
  respond(id, result) {
    this.child.stdin.write(JSON.stringify({ id, result }) + "\n");
  }
}
