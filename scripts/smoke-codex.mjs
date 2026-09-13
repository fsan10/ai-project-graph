import { CodexClient } from "../server/codex-client.mjs";
let finish;
const completed = new Promise((resolve) => {
  finish = resolve;
});
const client = new CodexClient(
  (e) => {
    if (e.method === "item/completed" && e.params.item.type === "agentMessage")
      console.log("REPLY", e.params.item.text);
    if (e.method === "turn/completed") {
      console.log(
        "STATUS",
        e.params.turn.status,
        e.params.turn.error?.message || "",
      );
      finish();
    }
  },
  (e) => {
    console.error(e.message);
    finish();
  },
);
const timeout = setTimeout(() => {
  console.error("Smoke test timed out");
  finish();
}, 55000);
try {
  await client.start();
  const r = await client.call("thread/start", {
    cwd: process.cwd(),
    sandbox: "read-only",
    approvalPolicy: "never",
    ephemeral: true,
  });
  await client.call("turn/start", {
    threadId: r.thread.id,
    input: [
      {
        type: "text",
        text: "这是应用连接测试。请只回复：连接成功。不要读取文件或使用工具。",
      },
    ],
  });
  await completed;
} finally {
  clearTimeout(timeout);
  client.close();
}
