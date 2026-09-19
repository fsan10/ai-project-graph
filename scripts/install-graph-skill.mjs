import { mkdir, copyFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const repo = fileURLToPath(new URL("../", import.meta.url));
const destination = join(
  process.env.CODEX_HOME || join(homedir(), ".codex"),
  "skills",
  "project-graph",
);
await mkdir(join(destination, "scripts"), { recursive: true });
try {
  await access(join(destination, "SKILL.md"));
  await copyFile(
    join(destination, "SKILL.md"),
    join(destination, "SKILL.previous.md"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await copyFile(
  resolve(repo, "skills/project-graph/SKILL.md"),
  join(destination, "SKILL.md"),
);
await writeFile(
  join(destination, "scripts", "graphctl.mjs"),
  `// Installed by AI Project Graph. The executable stays in its source repository.\nprocess.env.GRAPH_RUNTIME ??= ${JSON.stringify(resolve(repo, ".data/native-runtime.json"))};\nawait import(${JSON.stringify(new URL("./graphctl.mjs", import.meta.url).href)});\n`,
);
console.log(`Installed project-graph Skill: ${destination}`);
