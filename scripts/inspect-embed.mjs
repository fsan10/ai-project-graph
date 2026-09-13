const targets = await (await fetch('http://127.0.0.1:9231/json/list')).json();
const target = targets.find(t => t.type === 'page' && t.url.startsWith('app://-/index.html') && !t.url.includes('avatar-overlay'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => { const data = JSON.parse(event.data); pending.get(data.id)?.(data); };
function call(method, params) { return new Promise(resolve => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); }); }
try {
  const result = await call('Runtime.evaluate', { expression: `(async () => { const frame=document.getElementById('ai-project-graph-codex-frame'); if(!frame) return {error:'No frame'}; const doc=frame.contentDocument; return {text:doc?.body?.innerText,inputs:doc?.querySelectorAll('textarea:not(:disabled)').length}; })()`, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(result.result?.result?.value || result));
} finally { ws.close(); }
