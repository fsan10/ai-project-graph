import assert from "node:assert/strict";
import test from "node:test";

test("renders the Chinese project graph working surface and final metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>AI 项目图谱<\/title>/i);
  assert.match(html, /class="app-shell"/i);
  assert.match(html, /以架构为中心的 AI 编程工作台/i);
  assert.match(html, /按住空格拖动画布/i);
  assert.match(html, /connection-handle/i);
  assert.match(html, /确认并完成/i);
  assert.doesNotMatch(html, /⌘K/);
  assert.doesNotMatch(html, /codex-preview/i);
});
