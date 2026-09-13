import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 9231;
const DEFAULT_APP_URL = "http://127.0.0.1:5173/index.html?host=codex";
const ENTRY_ID = "ai-project-graph-codex-entry";
const FRAME_ID = "ai-project-graph-codex-frame";
const FRAME_URL_ATTRIBUTE = "data-ai-project-graph-frame-url";
const INJECTION_KEY = "__aiProjectGraphCodexInjection__";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const VITE_ENTRY = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));

const args = process.argv.slice(2);
const option = (name, fallback = undefined) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const port = Number(option("--port", DEFAULT_PORT));
const watch = args.includes("--watch");
const autoStartApp = !args.includes("--no-app-server");
const appUrl = option("--app-url", process.env.AI_PROJECT_GRAPH_APP_URL || DEFAULT_APP_URL);
const sourcePath = new URL("../public/codex-project-graph.user.js", import.meta.url);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("--port must be an integer between 1 and 65535");
}

let parsedAppUrl;
try {
  parsedAppUrl = new URL(appUrl);
  if (!/^https?:$/.test(parsedAppUrl.protocol)) throw new Error("unsupported protocol");
} catch (_) {
  throw new Error(`--app-url 不是有效的 HTTP(S) 地址: ${appUrl}`);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isLoopbackUrl(url) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

async function fetchAppDocument() {
  let response;
  try {
    response = await fetch(appUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error(`无法访问项目页面 ${appUrl}: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`项目页面 ${appUrl} 返回 ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  const baseHref = new URL("./", resourceBaseUrl || appUrl).href;
  const baseTag = `<base href=${JSON.stringify(baseHref)}>`;
  if (/<base\b/i.test(html)) return html;
  if (!/<head(?:\s|>)/i.test(html)) {
    throw new Error("项目页面没有 head 元素，无法在 Codex 隔离页面中加载");
  }
  return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
}

let appServer = null;
let resourceProxy = null;
let resourceBaseUrl = "";
let appReadyPromise = null;

async function isAppReachable() {
  try {
    const response = await fetch(appUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_200),
    });
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function ensureAppServer() {
  if (appReadyPromise) return appReadyPromise;
  appReadyPromise = (async () => {
    if (!(await isAppReachable()) && (!autoStartApp || !isLoopbackUrl(parsedAppUrl))) {
      throw new Error(
        `项目页面不可用: ${appUrl}。请先启动项目，或使用默认本地地址。`,
      );
    }

    if (!(await isAppReachable())) {
      const appPort = Number(parsedAppUrl.port || (parsedAppUrl.protocol === "https:" ? 443 : 80));
      if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) {
        throw new Error(`项目页面端口无效: ${parsedAppUrl.port}`);
      }
      console.log(`Starting local project server at http://127.0.0.1:${appPort}...`);
      appServer = spawn(
        process.execPath,
        [VITE_ENTRY, "--config", "vite.local.config.mjs", "--host", "127.0.0.1", "--port", String(appPort)],
        {
          cwd: PROJECT_ROOT,
          stdio: "inherit",
          windowsHide: true,
        },
      );

      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (appServer.exitCode !== null) {
          throw new Error(`项目页面服务提前退出，退出码 ${appServer.exitCode}`);
        }
        if (await isAppReachable()) break;
        await sleep(250);
      }
      if (!(await isAppReachable())) throw new Error(`等待项目页面超时: ${appUrl}`);
    }

    if (!isLoopbackUrl(parsedAppUrl)) {
      resourceBaseUrl = parsedAppUrl.origin;
      return;
    }

    // Requests issued by a document whose security origin is app://- carry
    // cross-site fetch metadata. vinext intentionally rejects those requests,
    // so serve the local Vite output through this tiny same-machine proxy.
    resourceProxy = createServer(async (request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, POST", "access-control-allow-headers": "content-type, x-graph-token" });
        response.end(); return;
      }
      if (!["GET", "HEAD", "POST"].includes(request.method)) {
        response.writeHead(405, { Allow: "GET, HEAD, POST" });
        response.end("Method Not Allowed");
        return;
      }
      const upstreamUrl = new URL(request.url || "/", parsedAppUrl.origin);
      const headers = Object.fromEntries(
        Object.entries(request.headers)
          .filter(([name]) => ![
            "connection", "content-length", "host", "origin", "referer",
            "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site",
          ].includes(name))
          .filter(([, value]) => typeof value === "string"),
      );
      try {
        let body;
        if (request.method === "POST") { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 100000) throw new Error("Request too large"); chunks.push(chunk); } body = Buffer.concat(chunks); }
        const upstream = await fetch(upstreamUrl, { method: request.method, headers, body, cache: "no-store" });
        response.statusCode = upstream.status;
        upstream.headers.forEach((value, name) => {
          if (!["connection", "content-encoding", "content-length", "transfer-encoding"].includes(name)) {
            response.setHeader(name, value);
          }
        });
        // Page.setDocumentContent creates an opaque (about:blank) frame origin.
        // Vite's browser entry is an ES module, so the frame loads it through a
        // CORS request; without this header the page renders SSR HTML but the
        // client never hydrates and every control appears inert.
        response.setHeader("access-control-allow-origin", "*");
        response.setHeader("cross-origin-resource-policy", "cross-origin");
        response.end(request.method === "HEAD" ? undefined : Buffer.from(await upstream.arrayBuffer()));
      } catch (error) {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end(`Local project proxy failed: ${error.message}`);
      }
    });
    await new Promise((resolve, reject) => {
      resourceProxy.once("error", reject);
      resourceProxy.listen(0, "127.0.0.1", resolve);
    });
    const address = resourceProxy.address();
    if (!address || typeof address === "string") throw new Error("无法确定项目资源代理端口");
    resourceBaseUrl = `http://127.0.0.1:${address.port}`;
    console.log(`Local project resource proxy: ${resourceBaseUrl}`);
  })();
  try {
    await appReadyPromise;
  } catch (error) {
    appReadyPromise = null;
    throw error;
  }
}

async function json(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  } catch (_) {
    throw new Error(
      `无法连接 Codex CDP ${url}。请完全退出 Codex 后，使用 --remote-debugging-port=${port} 重新启动。`,
    );
  }
  if (!response.ok) throw new Error(`Codex CDP 返回 ${response.status} ${response.statusText}`);
  return response.json();
}

function isCodexTarget(target) {
  return target?.type === "page"
    && target.webSocketDebuggerUrl
    && target.url?.startsWith("app://-/index.html")
    && !target.url.includes("initialRoute=%2Favatar-overlay");
}

function cdpCall(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++ws.__codexRequestId;
    ws.__codexPending.set(id, { resolve, reject });
    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      ws.__codexPending.delete(id);
      reject(error);
    }
  });
}

async function openCdp(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.__codexRequestId = 0;
  ws.__codexPending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const pending = ws.__codexPending.get(message.id);
    if (!pending) return;
    ws.__codexPending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || "CDP request failed"));
    else pending.resolve(message.result);
  });
  const failure = (error) => {
    for (const pending of ws.__codexPending.values()) pending.reject(error);
    ws.__codexPending.clear();
  };
  ws.addEventListener("close", () => failure(new Error("Codex CDP 连接已关闭")), { once: true });
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      ws.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      ws.removeEventListener("open", onOpen);
      reject(new Error("无法建立 Codex CDP WebSocket 连接"));
    };
    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("error", onError, { once: true });
  });
  return ws;
}

function closeCdp(ws) {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
}

async function evaluate(ws, expression) {
  return cdpCall(ws, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
}

async function evaluateSource(ws, source) {
  const evaluation = await evaluate(ws, `(() => {
    (0, eval)(${JSON.stringify(source)});
    return {
      entry: Boolean(document.getElementById(${JSON.stringify(ENTRY_ID)})),
      installed: Boolean(window[${JSON.stringify(INJECTION_KEY)}]),
      url: window.location.href,
    };
  })()`);
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || "项目图谱脚本执行失败");
  }
  return evaluation;
}

async function readFrameInfo(ws) {
  const evaluation = await evaluate(ws, `(() => {
    const frame = document.getElementById(${JSON.stringify(FRAME_ID)});
    if (!frame) return null;
    return {
      name: frame.name || "",
      src: frame.getAttribute("src") || "",
      url: frame.getAttribute(${JSON.stringify(FRAME_URL_ATTRIBUTE)}) || "",
      connected: frame.isConnected,
    };
  })()`);
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || "无法读取项目图谱 iframe");
  }
  return evaluation.result?.value || null;
}

function findFrameByName(frameTree, name) {
  if (frameTree?.frame?.name === name) return frameTree.frame;
  for (const child of frameTree?.childFrames || []) {
    const match = findFrameByName(child, name);
    if (match) return match;
  }
  return null;
}

async function hydrateFrame(ws, target, frameStates) {
  const frameInfo = await readFrameInfo(ws);
  if (!frameInfo?.connected || !frameInfo.name) return false;
  const previous = frameStates.get(target.id);
  if (previous?.name === frameInfo.name && previous.url === appUrl && Date.now() - previous.checkedAt < 5000) return false;

  const html = await fetchAppDocument();
  const token = html.match(/window\.__GRAPH_TOKEN__\s*=\s*"([^"]+)"/)?.[1];
  if (previous?.name === frameInfo.name && previous.url === appUrl && previous.token === token) {
    previous.checkedAt = Date.now();
    return false;
  }

  const { frameTree } = await cdpCall(ws, "Page.getFrameTree");
  const targetFrame = findFrameByName(frameTree, frameInfo.name);
  if (!targetFrame) return false;

  await cdpCall(ws, "Page.setDocumentContent", {
    frameId: targetFrame.id,
    html,
  });
  frameStates.set(target.id, { name: frameInfo.name, url: appUrl, token, checkedAt: Date.now() });
  console.log(JSON.stringify({ target: target.id, frame: frameInfo.name, page: "loaded" }));
  return true;
}

async function injectOnce(lastStates, frameStates) {
  const targets = (await json(`http://127.0.0.1:${port}/json/list`)).filter(isCodexTarget);
  const liveIds = new Set(targets.map((target) => target.id));
  for (const id of lastStates.keys()) {
    if (!liveIds.has(id)) lastStates.delete(id);
  }
  for (const id of frameStates.keys()) {
    if (!liveIds.has(id)) frameStates.delete(id);
  }
  if (targets.length > 0) await ensureAppServer();

  const source = await readFile(sourcePath, "utf8");
  for (const target of targets) {
    const ws = await openCdp(target);
    try {
      await cdpCall(ws, "Page.enable");
      await cdpCall(ws, "Page.setBypassCSP", { enabled: true });
      await cdpCall(ws, "Runtime.enable");
      const evaluation = await evaluateSource(ws, source);
      const state = evaluation.result?.value || {};
      if (evaluation.exceptionDetails) {
        throw new Error(evaluation.exceptionDetails.exception?.description || "项目图谱脚本执行失败");
      }
      const previous = lastStates.get(target.id);
      if (!previous || previous.entry !== state.entry || previous.installed !== state.installed) {
        console.log(JSON.stringify({
          target: target.id,
          entry: Boolean(state.entry),
          installed: Boolean(state.installed),
        }));
      }
      lastStates.set(target.id, { entry: Boolean(state.entry), installed: Boolean(state.installed) });
      if (args.includes("--open") && !previous) {
        await evaluate(ws, `window[${JSON.stringify(INJECTION_KEY)}]?.open?.()`);
      }
      await hydrateFrame(ws, target, frameStates);
    } finally {
      closeCdp(ws);
    }
  }
  return targets.length;
}

const states = new Map();
const frameStates = new Map();
let waitingLogged = false;
let stopping = false;
const requestStop = () => { stopping = true; };
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

do {
  try {
    const count = await injectOnce(states, frameStates);
    if (count === 0 && !waitingLogged) {
      console.log(`Waiting for a Codex renderer on 127.0.0.1:${port}...`);
      waitingLogged = true;
    }
    if (count > 0) waitingLogged = false;
  } catch (error) {
    if (!waitingLogged) {
      console.error(`Codex injection unavailable: ${error.message}`);
      waitingLogged = true;
    }
  }
  if (!watch || stopping) break;
  await sleep(1_000);
} while (!stopping);

if (resourceProxy) resourceProxy.close();
if (appServer && !appServer.killed) appServer.kill();
