import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";
export const samePath = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  resolve(a).toLowerCase() === resolve(b).toLowerCase();
export async function nativeCatalog() {
  const file =
    process.env.GRAPH_CODEX_STATE ||
    join(
      process.env.CODEX_HOME || join(homedir(), ".codex"),
      ".codex-global-state.json",
    );
  const state = JSON.parse(await readFile(file, "utf8"));
  const ids =
    state["app-server-project-id-by-legacy-project-id-by-host"]?.local || {};
  const projects = Object.entries(state["local-projects"] || {})
    .filter(([, p]) => Array.isArray(p.rootPaths) && p.rootPaths.length)
    .map(([id, p]) => ({
      id,
      canonicalId: ids[id] || id,
      name: p.name || id,
      roots: p.rootPaths,
      path: p.rootPaths[0],
    }));
  return {
    projects,
    selectedProjectId: state["selected-project"]?.projectId,
    assignments: state["thread-project-assignments"] || {},
    rootHints: state["thread-workspace-root-hints"] || {},
  };
}
export function projectForCwd(projects, cwd) {
  return (
    projects.find((p) => p.roots.some((r) => samePath(r, cwd))) ||
    projects.find((p) =>
      p.roots.some((r) => {
        const rest = relative(r, cwd);
        return (
          rest && !rest.startsWith("..") && !isAbsolute(rest)
        );
      }),
    )
  );
}
export function belongsToProject(thread, project, catalog) {
  const rawAssignment = catalog.assignments[thread.id];
  const assignment = typeof rawAssignment === 'string' ? rawAssignment : rawAssignment?.projectId;
  if (assignment)
    return [project.id, project.canonicalId].includes(assignment);
  if (
    thread.projectId &&
    [project.id, project.canonicalId].includes(thread.projectId)
  )
    return true;
  return project.roots.some((r) => samePath(r, thread.cwd));
}
