import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve,join} from 'node:path';
const runtime=resolve('.data/native-launch.json');
console.log('正在构建 Codex 图谱界面…');
execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','vite.local.config.mjs'],{stdio:'inherit',windowsHide:true});
let previous;try{previous=JSON.parse(await readFile(runtime,'utf8'));}catch{}
let port;
for(const candidate of [...new Set([previous?.port,9231,9232].filter(Boolean))]){try{const targets=await (await fetch(`http://127.0.0.1:${candidate}/json/list`,{signal:AbortSignal.timeout(700)})).json();if(targets.some(t=>t.type==='page'&&t.url?.startsWith('app://-/index.html'))){port=candidate;break;}}catch{}}
if(!port){
  if(process.platform!=='win32')throw new Error('请先以独立 CDP 端口启动 Codex，再运行 codex:inject。');
  const install=process.env.CODEX_APP_PATH || join(execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage OpenAI.Codex | Select-Object -First 1 -ExpandProperty InstallLocation)'],{encoding:'utf8',windowsHide:true}).trim(),'app','ChatGPT.exe');
  const socket=createServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r);});port=socket.address().port;await new Promise(r=>socket.close(r));
  await mkdir(resolve('.data'),{recursive:true});
  const child=spawn(install,[`--remote-debugging-port=${port}`,`--remote-allow-origins=http://127.0.0.1:${port}`,`--user-data-dir=${resolve('.data/codex-native-profile')}`],{windowsHide:false,detached:true,stdio:'ignore'});child.on('error',e=>{console.error(e.message);process.exitCode=1;});child.unref();
  console.log('已启动独立 Codex 图谱窗口；原有窗口保持运行。');
}
await mkdir(resolve('.data'),{recursive:true});await writeFile(runtime,JSON.stringify({port}));
const injector=spawn(process.execPath,['scripts/codex-project-graph-injector.mjs','--port',String(port),'--watch','--open'],{stdio:'inherit',windowsHide:true});
process.once('SIGINT',()=>injector.kill());process.once('SIGTERM',()=>injector.kill());injector.once('exit',code=>{process.exitCode=code||0;});
