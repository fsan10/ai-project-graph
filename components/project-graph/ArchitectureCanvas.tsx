import { GitBranch } from "lucide-react";
import type { GraphNode } from "../../lib/workspace-types";
export function ArchitectureCanvas({
  nodes,
  onSelect,
}: {
  nodes: GraphNode[];
  onSelect: (id: string) => void;
}) {
  const depths = new Map<string, number>();
  function depth(n: GraphNode): number {
    if (depths.has(n.id)) return depths.get(n.id)!;
    const d = n.dependencies.length
      ? Math.max(
          ...n.dependencies.map((id) => depth(nodes.find((x) => x.id === id)!)),
        ) + 1
      : 0;
    depths.set(n.id, d);
    return d;
  }
  const counts = new Map<number, number>();
  const positions = new Map(
    nodes.map((n) => {
      const d = depth(n),
        row = counts.get(d) || 0;
      counts.set(d, row + 1);
      return [n.id, { x: d * 300 + 15, y: row * 220 + 15 }];
    }),
  );
  const width = (Math.max(...depths.values()) + 1) * 300;
  const height = Math.max(...counts.values()) * 220;
  return (
    <div className="pw-canvas-scroll">
      <div className="pw-canvas" style={{ width, height }}>
        <svg width={width} height={height} aria-label="节点依赖连线">
          <defs>
            <marker
              id="pw-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0 0L8 4L0 8" fill="none" stroke="#91a57c" />
            </marker>
          </defs>
          {nodes.flatMap((n) =>
            n.dependencies.map((id) => {
              const a = positions.get(id)!,
                b = positions.get(n.id)!;
              return (
                <path
                  key={`${id}-${n.id}`}
                  d={`M${a.x + 240},${a.y + 82} C${a.x + 275},${a.y + 82} ${b.x - 35},${b.y + 82} ${b.x - 4},${b.y + 82}`}
                  fill="none"
                  stroke="#a6b696"
                  strokeWidth="1.5"
                  markerEnd="url(#pw-arrow)"
                />
              );
            }),
          )}
        </svg>
        {nodes.map((n) => {
          const p = positions.get(n.id)!;
          return (
            <button
              className="pw-graph-card"
              key={n.id}
              style={{ left: p.x, top: p.y }}
              onClick={() => onSelect(n.id)}
            >
              <small>
                {n.dependencies.length ? "依赖节点就绪后推进" : "起始节点"}
              </small>
              <strong>
                <GitBranch size={15} />
                {n.title}
              </strong>
              <p>{n.goal}</p>
              <span>
                {n.tasks.filter((t) => t.status === "done").length} /{" "}
                {n.tasks.length} 项任务完成 ↗
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
