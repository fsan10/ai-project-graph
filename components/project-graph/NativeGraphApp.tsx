"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  Folder,
  GitBranch,
  Grip,
  Link2,
  Maximize,
  MessageSquare,
  Minus,
  Plus,
  Search,
  Workflow,
  X,
} from "lucide-react";
import { nodesInMarquee, rectFromPoints } from "../../lib/canvas";
import type {
  NativeGraph,
  NativeProject,
  NativeThread,
} from "../../lib/native-graph-types";
import "./native-graph.css";
declare global {
  interface Window {
    __GRAPH_TOKEN__?: string;
  }
}
const labels: Record<string, string> = {
  todo: "待开始",
  in_progress: "进行中",
  in_review: "待验收",
  done: "已完成",
};
const nodeLabels: Record<string, string> = {
  todo: "待对齐",
  ready: "待开始",
  in_progress: "进行中",
  in_review: "待验收",
  done: "已完成",
};
const memoryLabels: Record<string, string> = {
  draft: "尚未建立记忆",
  aligning: "只读对齐中",
  ready: "记忆已对齐",
  stale: "目标已变更，需重新对齐",
};
type Point = { x: number; y: number };
async function api(
  query: Record<string, string> = {},
  payload?: Record<string, unknown>,
) {
  const url = new URL("/api/native-graph", document.baseURI);
  url.search = new URLSearchParams(query).toString();
  const r = await fetch(url, {
    method: payload ? "POST" : "GET",
    headers: {
      "x-graph-token": window.__GRAPH_TOKEN__ || "",
      "content-type": "application/json",
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || "连接失败");
  return value;
}
async function host(action: string, payload: Record<string, unknown>) {
  if (window.parent === window)
    throw new Error("请从 Codex 侧边栏「项目图谱」打开此页面，使用原生对话。");
  const requestId = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    const listener = (e: MessageEvent) => {
      if (
        e.source !== window.parent ||
        e.data?.type !== "ai-project-graph:native-result" ||
        e.data.requestId !== requestId
      )
        return;
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve();
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", listener);
      reject(new Error("Codex 原生桥接未响应，请重新打开项目图谱"));
    }, 12000);
    window.addEventListener("message", listener);
    window.parent.postMessage(
      { type: "ai-project-graph:native", requestId, action, payload },
      "*",
    );
  });
}
export function NativeGraphApp() {
  const [projects, setProjects] = useState<NativeProject[]>([]),
    [projectId, setProjectId] = useState("");
  const [graph, setGraph] = useState<NativeGraph | null>(null),
    [threads, setThreads] = useState<NativeThread[]>([]),
    [error, setError] = useState("");
  const [view, setView] = useState({ x: 30, y: 40, zoom: 1 }),
    [selected, setSelected] = useState<string[]>([]),
    [popover, setPopover] = useState<string | null>(null);
  const [newNode, setNewNode] = useState(false),
    [title, setTitle] = useState(""),
    [goal, setGoal] = useState(""),
    [prompt, setPrompt] = useState("");
  const [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<NativeThread[]>([]),
    [history, setHistory] = useState(false),
    [searchBusy, setSearchBusy] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false),
    [board, setBoard] = useState(true),
    [connecting, setConnecting] = useState(false),
    [source, setSource] = useState<string | null>(null),
    [edgeMenu, setEdgeMenu] = useState<string | null>(null),
    [marquee, setMarquee] = useState<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLDivElement>(null),
    current = useRef({ graph, view, selected, projectId });
  useLayoutEffect(() => {
    current.current = { graph, view, selected, projectId };
  }, [graph, view, selected, projectId]);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 700 });
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setCanvasSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const drag = useRef<{
      kind: "node" | "pan" | "marquee";
      start: Point;
      origins: Record<string, Point>;
      view: typeof view;
      ids: string[];
      clickedId?: string;
      moved: boolean;
      projectId: string;
    } | null>(null),
    space = useRef(false);
  const project = projects.find((p) => p.id === projectId),
    node = graph?.nodes.find((n) => n.id === popover);
  const refresh = useCallback(async (id: string, force = false) => {
    const data = await api({
      projectId: id,
      ...(force ? { refresh: "true" } : {}),
    });
    if (current.current.projectId === id && !drag.current) {
      setGraph(data.graph);
      setThreads(data.threads);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api({ action: "projects" });
        if (!alive) return;
        setProjects(data.projects);
        setProjectId((old) =>
          data.projects.some((p: NativeProject) => p.id === old)
            ? old
            : data.selectedProjectId || data.projects[0]?.id || "",
        );
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    const listener = (e: MessageEvent) => {
      if (
        e.source === window.parent &&
        e.data?.type === "ai-project-graph:theme"
      )
        document.documentElement.dataset.theme = e.data.theme;
    };
    window.addEventListener("message", listener);
    window.parent.postMessage({ type: "ai-project-graph:frame-ready" }, "*");
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("message", listener);
    };
  }, []);
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const load = () =>
      refresh(projectId).catch((e) => {
        if (alive) setError(e.message);
      });
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId, refresh]);
  useEffect(() => {
    if (!searchOpen || !projectId) return;
    let alive = true;
    const timer = setTimeout(async () => {
      setSearchBusy(true);
      try {
        const data = await api({
          projectId,
          action: "search",
          q: query,
          history: String(history),
        });
        if (alive) {
          setResults(data.threads);
          if (data.unavailable?.length)
            setError(
              `${data.unavailable.length} 段对话的历史暂不可读，其余结果已显示`,
            );
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setSearchBusy(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, searchOpen, projectId, history]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        space.current = true;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(current.current.graph?.nodes.map((n) => n.id) || []);
      }
      if (e.key === "Escape") {
        setPopover(null);
        setSearchOpen(false);
        setDocumentOpen(false);
        setNewNode(false);
        setSource(null);
        setConnecting(false);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    const blur = () => {
      space.current = false;
      drag.current = null;
      setMarquee(null);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  async function mutate(payload: Record<string, unknown>) {
    const id = current.current.projectId;
    setError("");
    setBusy(true);
    try {
      const data = await api({}, { projectId: id, ...payload });
      if (current.current.projectId === id && data.graph) setGraph(data.graph);
      return data;
    } catch (e) {
      setError((e as Error).message);
      await refresh(id).catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function openThread(threadId: string) {
    try {
      await api({ action: "thread", projectId, threadId });
      await host("open", { threadId, project });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function prepare(nodeId?: string) {
    if (!project) return;
    setBusy(true);
    try {
      const data = await api({}, { action: "prepare", projectId, nodeId });
      if (data.mode === "open")
        await host("open", { threadId: data.threadId, project: data.project });
      else
        await host("new", {
          project: data.project,
          instruction: data.instruction,
        });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function forkNode(nodeId: string) {
    setBusy(true);
    setError("");
    try {
      const data = await api(
        {},
        { action: "fork", projectId: current.current.projectId, nodeId },
      );
      setGraph(data.graph);
      await host("open", { threadId: data.thread.id, project });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function world(x: number, y: number) {
    const r = canvas.current!.getBoundingClientRect(),
      v = current.current.view;
    return { x: (x - r.left - v.x) / v.zoom, y: (y - r.top - v.y) / v.zoom };
  }
  function start(e: React.PointerEvent, id?: string) {
    if (e.button !== 0 && e.button !== 1) return;
    if (
      (e.target as HTMLElement).closest("button,input,textarea,select") &&
      !id
    )
      return;
    e.preventDefault();
    setEdgeMenu(null);
    if (id && connecting) {
      if (!source) setSource(id);
      else {
        if (source !== id)
          void mutate({ action: "edge-add", source, target: id });
        setSource(null);
        setConnecting(false);
      }
      return;
    }
    const v = current.current.view,
      existing = current.current.selected;
    const pan = e.button === 1 || space.current || (!id && !e.shiftKey);
    if (pan) {
      drag.current = {
        kind: "pan",
        start: { x: e.clientX, y: e.clientY },
        view: v,
        origins: {},
        ids: [],
        moved: false,
        projectId,
      };
      setPopover(null);
    } else if (id) {
      const ids = e.shiftKey
        ? [...new Set([...existing, id])]
        : existing.includes(id)
          ? existing
          : [id];
      setSelected(ids);
      drag.current = {
        kind: "node",
        start: { x: e.clientX, y: e.clientY },
        view: v,
        origins: Object.fromEntries(
          graph!.nodes
            .filter((n) => ids.includes(n.id))
            .map((n) => [n.id, { x: n.x, y: n.y }]),
        ),
        ids,
        clickedId: id,
        moved: false,
        projectId,
      };
    } else {
      const point = world(e.clientX, e.clientY);
      drag.current = {
        kind: "marquee",
        start: point,
        view: v,
        origins: {},
        ids: existing,
        moved: false,
        projectId,
      };
      setMarquee({ ...point, width: 0, height: 0 });
      setPopover(null);
    }
    canvas.current?.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "marquee") {
      const r = rectFromPoints(d.start, world(e.clientX, e.clientY));
      setMarquee(r);
      setSelected([
        ...new Set([
          ...d.ids,
          ...nodesInMarquee(
            (graph?.nodes || []).map((n) => ({
              ...n,
              width: 250,
              height: 156,
            })),
            r,
          ),
        ]),
      ]);
      return;
    }
    const dx = e.clientX - d.start.x,
      dy = e.clientY - d.start.y;
    d.moved ||= Math.abs(dx) + Math.abs(dy) > 4;
    if (d.kind === "pan")
      setView({ ...d.view, x: d.view.x + dx, y: d.view.y + dy });
    else {
      setPopover(null);
      setGraph((g) =>
        g
          ? {
              ...g,
              nodes: g.nodes.map((n) =>
                d.origins[n.id]
                  ? {
                      ...n,
                      x: d.origins[n.id].x + dx / d.view.zoom,
                      y: d.origins[n.id].y + dy / d.view.zoom,
                    }
                  : n,
              ),
            }
          : g,
      );
    }
  }
  function end(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setMarquee(null);
    if (d.kind === "node") {
      if (d.moved) {
        void mutate({
          action: "layout",
          positions: current.current
            .graph!.nodes.filter((n) => d.ids.includes(n.id))
            .map((n) => ({ id: n.id, x: n.x, y: n.y })),
        });
      } else setPopover(d.clickedId || null);
    } else if (d.kind === "pan" && !d.moved) {
      setPopover(null);
      setSelected([]);
    }
    if (canvas.current?.hasPointerCapture(e.pointerId))
      canvas.current.releasePointerCapture(e.pointerId);
  }
  function zoom(delta: number, point?: Point) {
    setView((v) => {
      const z = Math.max(0.2, Math.min(2.5, v.zoom * delta));
      const p = point || {
        x: (canvas.current?.clientWidth || 800) / 2,
        y: (canvas.current?.clientHeight || 600) / 2,
      };
      return {
        x: p.x - ((p.x - v.x) * z) / v.zoom,
        y: p.y - ((p.y - v.y) * z) / v.zoom,
        zoom: z,
      };
    });
    setPopover(null);
  }
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".ng-popover")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(e.deltaY > 0 ? 0.9 : 1.1, {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  function fit() {
    if (!graph?.nodes.length) return;
    const xs = graph.nodes.map((n) => n.x),
      ys = graph.nodes.map((n) => n.y),
      minX = Math.min(...xs),
      minY = Math.min(...ys);
    const w = Math.max(...xs) - minX + 300,
      h = Math.max(...ys) - minY + 220,
      z = Math.min(
        1,
        (canvas.current!.clientWidth - 80) / w,
        (canvas.current!.clientHeight - 80) / h,
      );
    setView({ x: 40 - minX * z, y: 40 - minY * z, zoom: Math.max(0.2, z) });
    setPopover(null);
  }
  const classified = new Set(graph?.nodes.flatMap((n) => n.threadIds) || []),
    unclassified = threads.filter((t) => !classified.has(t.id));
  const selectedThreads =
    node?.threadIds.map((id) => ({
      ...(threads.find((t) => t.id === id) || {
        id,
        title: "Codex 原生对话",
        preview: "",
        updatedAt: 0,
        status: "unknown",
      }),
      relation: node.conversations.find(
        (conversation) => conversation.threadId === id,
      ),
    })) || [];
  const tasks =
    graph?.nodes.flatMap((n) => n.tasks.map((t) => ({ ...t, node: n }))) || [];
  return (
    <div className="ng-app">
      <header className="ng-header">
        <div className="ng-brand">
          <Workflow size={21} />
          <strong>项目图谱</strong>
          <span> / </span>
          <Folder size={15} />
          <select
            aria-label="选择 Codex 项目"
            value={projectId}
            onChange={(e) => {
              setGraph(null);
              setThreads([]);
              setPopover(null);
              setSelected([]);
              setSource(null);
              setView({ x: 30, y: 40, zoom: 1 });
              setProjectId(e.target.value);
            }}
          >
            {!projects.length && <option>读取 Codex 项目…</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="ng-header-actions">
          <button onClick={() => setSearchOpen(true)}>
            <Search size={15} />
            搜索当前项目 <kbd>Ctrl F</kbd>
          </button>
          <button onClick={() => setDocumentOpen(true)}>
            <FileText size={15} />
            开发文档
          </button>
          <button onClick={() => setBoard(!board)}>
            <Grip size={15} />
            看板
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="ng-error">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="ng-body">
        <main className="ng-main">
          <div className="ng-toolbar">
            <div>
              <strong>{graph?.name || project?.name || "项目架构"}</strong>
              <span>
                {graph?.nodes.length || 0} 个节点 · {threads.length} 段原生对话
                · {unclassified.length} 段未分类
              </span>
            </div>
            <div>
              <button
                className={connecting ? "active" : ""}
                onClick={() => {
                  setConnecting(!connecting);
                  setPopover(null);
                  setSource(null);
                }}
              >
                <Link2 size={14} />
                {connecting ? "依次点击两个节点" : "连接节点"}
              </button>
              <button
                onClick={() => {
                  setTitle("");
                  setGoal("");
                  setNewNode(true);
                }}
                disabled={!project}
              >
                <Plus size={15} />
                新增节点
              </button>
              <button
                className="ng-primary"
                onClick={() => void prepare()}
                disabled={!project || busy}
              >
                <MessageSquare size={15} />
                原生规划对话 <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
          <div
            className={`ng-canvas ${connecting ? "connecting" : ""}`}
            ref={canvas}
            onPointerDown={(e) => start(e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => {
              drag.current = null;
              setMarquee(null);
              void refresh(projectId);
            }}
            style={{
              backgroundPosition: `${view.x}px ${view.y}px`,
              backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
            }}
          >
            {!graph?.nodes.length && (
              <div className="ng-blank">
                <GitBranch size={34} />
                <h1>用架构，整理项目里的每一段对话</h1>
                <p>
                  在 Codex 原生对话中调用 <code>$project-graph</code>。<br />
                  先把项目开发文档聊清楚，确认后在这里生成架构。
                  <br />
                  也可以先新增节点，开始分类已有对话。
                </p>
                <button
                  onClick={() => void prepare()}
                  disabled={!project || busy}
                >
                  <MessageSquare size={15} />在 Codex 中开始规划{" "}
                  <ArrowUpRight size={14} />
                </button>
              </div>
            )}
            <div
              className="ng-world"
              style={{
                transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})`,
              }}
            >
              <svg className="ng-edges">
                <defs>
                  <marker
                    id="native-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0 0L8 4L0 8" fill="none" stroke="currentColor" />
                  </marker>
                </defs>
                {graph?.edges.map((edge) => {
                  const a = graph.nodes.find((n) => n.id === edge.source),
                    b = graph.nodes.find((n) => n.id === edge.target);
                  if (!a || !b) return null;
                  const x1 = a.x + 250,
                    y1 = a.y + 78,
                    x2 = b.x,
                    y2 = b.y + 78,
                    mid = (x1 + x2) / 2;
                  return (
                    <g
                      key={edge.id}
                      className={edgeMenu === edge.id ? "selected" : ""}
                    >
                      <path
                        d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
                        markerEnd="url(#native-arrow)"
                      />
                      <path
                        className="ng-edge-hit"
                        d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setEdgeMenu(edge.id);
                          setPopover(null);
                        }}
                      />
                      <text x={mid} y={(y1 + y2) / 2 - 9}>
                        {edge.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
              {graph?.nodes.map((n) => (
                <div
                  role="button"
                  aria-label={`${n.title}，${n.threadIds.length} 段对话`}
                  tabIndex={0}
                  data-node-id={n.id}
                  key={n.id}
                  className={`ng-node ${selected.includes(n.id) ? "selected" : ""} ${source === n.id ? "source" : ""}`}
                  style={{ left: n.x, top: n.y }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    start(e, n.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setPopover(n.id);
                      setSelected([n.id]);
                    }
                  }}
                >
                  <small>
                    <GitBranch size={12} />
                    {nodeLabels[n.status] || "项目节点"} <span>⋮</span>
                  </small>
                  <h3>{n.title}</h3>
                  <p>{n.goal || "为此分类添加目标与职责"}</p>
                  <footer>
                    <span>
                      <MessageSquare size={13} />
                      {n.threadIds.length} 段对话
                    </span>
                    <span>
                      {n.memory.status === "ready"
                        ? `记忆 v${n.memory.version}`
                        : memoryLabels[n.memory.status]}
                      <ChevronDown size={13} />
                    </span>
                  </footer>
                </div>
              ))}
              {marquee && (
                <div
                  className="ng-marquee"
                  style={{
                    left: marquee.x,
                    top: marquee.y,
                    width: marquee.width,
                    height: marquee.height,
                  }}
                />
              )}
            </div>
            {node && (
              <section
                className="ng-popover"
                aria-label={`${node.title}的对话`}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  left: Math.max(
                    12,
                    Math.min(
                      view.x + node.x * view.zoom,
                      canvasSize.width - 370,
                    ),
                  ),
                  top: Math.max(
                    12,
                    Math.min(
                      view.y + (node.y + 166) * view.zoom,
                      canvasSize.height - 430,
                    ),
                  ),
                }}
              >
                <div className="ng-popover-head">
                  <div>
                    <strong>{node.title}</strong>
                    <small>{node.threadIds.length} 段原生对话</small>
                  </div>
                  <button
                    aria-label="关闭节点弹层"
                    onClick={() => setPopover(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="ng-node-chats">
                  {!selectedThreads.length && (
                    <p className="ng-muted">
                      先创建记忆主对话，与 AI 只读对齐节点范围；确认核心记忆后，
                      才能从主线创建原生工作分支。
                    </p>
                  )}
                  {selectedThreads.map((t) => (
                    <button
                      className="ng-thread"
                      key={t.id}
                      onClick={() => void openThread(t.id)}
                    >
                      <div>
                        <MessageSquare size={14} />
                        <strong>{t.title}</strong>
                        <em
                          className={`ng-thread-kind ${t.relation?.kind || "imported"}`}
                        >
                          {t.relation?.kind === "memory"
                            ? "记忆主线"
                            : t.relation?.kind === "branch"
                              ? "原生分支"
                              : "已归类"}
                        </em>
                        <ArrowUpRight size={13} />
                      </div>
                      <code>{t.id}</code>
                    </button>
                  ))}
                </div>
                <button
                  className="ng-new-chat"
                  disabled={busy}
                  onClick={() =>
                    void (node.memory.status === "ready"
                      ? forkNode(node.id)
                      : prepare(node.id))
                  }
                >
                  {node.memory.status === "ready" ? (
                    <GitBranch size={15} />
                  ) : (
                    <MessageSquare size={15} />
                  )}
                  {node.memory.status === "ready"
                    ? "从节点记忆分支新对话"
                    : node.rootThreadId
                      ? "继续只读对齐"
                      : "开始节点只读对齐"}
                  <ArrowUpRight size={14} />
                </button>
                <div className={`ng-memory-state ${node.memory.status}`}>
                  <strong>{memoryLabels[node.memory.status]}</strong>
                  <span>
                    {node.memory.status === "ready"
                      ? `核心记忆 v${node.memory.version} · 后续对话继承完整主线历史`
                      : "对齐期只回答和澄清，不修改项目代码"}
                  </span>
                </div>
                <details>
                  <summary>
                    归入已有对话 · {unclassified.length} 段未分类
                  </summary>
                  {unclassified.map((t) => (
                    <button
                      className="ng-thread"
                      key={t.id}
                      onClick={() =>
                        void mutate({
                          action: "assign",
                          nodeId: node.id,
                          threadId: t.id,
                        })
                      }
                    >
                      <strong>{t.title}</strong>
                      <code>{t.id}</code>
                    </button>
                  ))}
                </details>
                <details>
                  <summary>节点目标、职责、核心记忆和状态</summary>
                  <label>
                    名称
                    <input
                      defaultValue={node.title}
                      key={node.id + "title"}
                      onBlur={(e) => {
                        if (e.target.value !== node.title)
                          void mutate({
                            action: "node-edit",
                            nodeId: node.id,
                            title: e.target.value,
                          });
                      }}
                    />
                  </label>
                  <label>
                    总目标
                    <textarea
                      defaultValue={node.goal}
                      key={node.id + "goal"}
                      onBlur={(e) => {
                        if (e.target.value !== node.goal)
                          void mutate({
                            action: "node-edit",
                            nodeId: node.id,
                            goal: e.target.value,
                          });
                      }}
                    />
                  </label>
                  <label>
                    职责提示词
                    <textarea
                      defaultValue={node.prompt}
                      key={node.id + "prompt"}
                      onBlur={(e) => {
                        if (e.target.value !== node.prompt)
                          void mutate({
                            action: "node-edit",
                            nodeId: node.id,
                            prompt: e.target.value,
                          });
                      }}
                    />
                  </label>
                  <p>
                    {node.memory.summary ||
                      node.summary ||
                      "暂无核心记忆；请先在记忆主对话中完成对齐。"}
                  </p>
                  {node.memory.acceptance && (
                    <p>验收边界：{node.memory.acceptance}</p>
                  )}
                  <label>
                    节点状态
                    <select
                      value={node.status}
                      onChange={(e) =>
                        void mutate({
                          action: "node-status",
                          nodeId: node.id,
                          status: e.target.value,
                        })
                      }
                    >
                      {Object.entries(nodeLabels).map(([status, text]) => (
                        <option key={status} value={status}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                </details>
                <button
                  className="ng-danger"
                  onClick={async () => {
                    await mutate({ action: "node-delete", nodeId: node.id });
                    setPopover(null);
                  }}
                >
                  移除节点分类（保留原生对话）
                </button>
              </section>
            )}
            {edgeMenu && (
              <div className="ng-edge-menu">
                <span>已选择节点连线</span>
                <button
                  onClick={async () => {
                    await mutate({ action: "edge-delete", edgeId: edgeMenu });
                    setEdgeMenu(null);
                  }}
                >
                  删除连线
                </button>
              </div>
            )}
            <div className="ng-canvas-footer">
              <span>
                拖动节点 · 拖动空白处平移 · 滚轮缩放 · Shift 框选 / 多选 · Ctrl
                A 全选
              </span>
              <div>
                <button aria-label="缩小" onClick={() => zoom(0.8)}>
                  <Minus size={15} />
                </button>
                <span>{Math.round(view.zoom * 100)}%</span>
                <button aria-label="放大" onClick={() => zoom(1.25)}>
                  <Plus size={15} />
                </button>
                <button aria-label="适应画布" onClick={fit}>
                  <Maximize size={15} />
                </button>
              </div>
            </div>
          </div>
        </main>
        {board && (
          <aside className="ng-board">
            <header>
              <strong>任务看板</strong>
              <span>
                {graph?.nodes.filter((item) => item.status === "done").length ||
                  0}
                /{graph?.nodes.length || 0} 节点
              </span>
            </header>
            {!graph?.nodes.length && (
              <div className="ng-board-empty">
                <Check size={24} />
                <h3>等待项目框架</h3>
                <p>
                  在原生对话确认开发文档后，
                  <br />
                  节点与小任务会出现在这里。
                </p>
              </div>
            )}
            {!!graph?.nodes.length && (
              <section className="ng-node-progress">
                <h4>
                  <GitBranch size={12} /> 节点进度
                </h4>
                {graph.nodes.map((item) => (
                  <article key={item.id}>
                    <button
                      onClick={() => {
                        setPopover(item.id);
                        setSelected([item.id]);
                      }}
                    >
                      {item.title}
                    </button>
                    <small>
                      {memoryLabels[item.memory.status]} ·{" "}
                      {item.threadIds.length} 段对话
                    </small>
                    <select
                      aria-label={`${item.title}节点状态`}
                      value={item.status}
                      onChange={(e) =>
                        void mutate({
                          action: "node-status",
                          nodeId: item.id,
                          status: e.target.value,
                        })
                      }
                    >
                      {Object.entries(nodeLabels).map(([status, text]) => (
                        <option key={status} value={status}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
              </section>
            )}
            {!!tasks.length && (
              <h3 className="ng-subtasks-title">节点子任务</h3>
            )}
            {!!tasks.length &&
              Object.entries(labels).map(([status, label]) => (
                <section key={status}>
                  <h4>
                    <i className={status} />
                    {label}
                    <span>
                      {tasks.filter((t) => t.status === status).length}
                    </span>
                  </h4>
                  {tasks
                    .filter((t) => t.status === status)
                    .map((t) => (
                      <article key={t.id}>
                        <button
                          onClick={() => {
                            setPopover(t.node.id);
                            setSelected([t.node.id]);
                          }}
                        >
                          {t.title}
                        </button>
                        <small>{t.node.title}</small>
                        {t.evidence && (
                          <details>
                            <summary>验证证据</summary>
                            <p>{t.evidence}</p>
                          </details>
                        )}
                        <select
                          aria-label={`${t.title}状态`}
                          value={status}
                          onChange={(e) => {
                            // The ref is read after this user event, never during render.
                            // eslint-disable-next-line react-hooks/refs
                            void mutate({
                              action: "task",
                              taskId: t.id,
                              status: e.target.value,
                            });
                          }}
                        >
                          {Object.entries(labels).map(([s, l]) => (
                            <option key={s} value={s}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </article>
                    ))}
                </section>
              ))}
            <p className="ng-board-note">
              Skill 同步进度与交接。
              <br />
              原生 Codex 保留完整对话和执行记录。
            </p>
          </aside>
        )}
      </div>
      {newNode && (
        <div className="ng-overlay" onClick={() => setNewNode(false)}>
          <form
            className="ng-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              const point = world(
                canvas.current!.getBoundingClientRect().left + 150,
                canvas.current!.getBoundingClientRect().top + 120,
              );
              const result = await mutate({
                action: "node-add",
                title,
                goal,
                prompt,
                ...point,
              });
              if (result) {
                setNewNode(false);
                setPopover(result.graph.nodes.at(-1).id);
                setTitle("");
                setGoal("");
                setPrompt("");
              }
            }}
          >
            <header>
              <strong>新增节点分类</strong>
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setNewNode(false)}
              >
                <X size={16} />
              </button>
            </header>
            <label>
              节点名称
              <input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：登录与权限"
              />
            </label>
            <label>
              总目标
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="这个节点负责什么？"
              />
            </label>
            <label>
              初始职责提示词
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="负责的模块、边界、相关接口与限制；稍后会在记忆主对话中继续对齐"
              />
            </label>
            <p>
              创建后先开启只读记忆主对话；对齐确认后，工作对话都从主线原生分支。
            </p>
            <button className="ng-primary" disabled={busy || !title.trim()}>
              添加到画布
            </button>
          </form>
        </div>
      )}
      {documentOpen && (
        <div className="ng-overlay" onClick={() => setDocumentOpen(false)}>
          <section
            className="ng-modal ng-document"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <strong>项目开发文档</strong>
              <button
                aria-label="关闭开发文档"
                onClick={() => setDocumentOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            {graph?.document ? (
              <>
                <p className="ng-muted">
                  用户确认于 {new Date(graph.confirmedAt!).toLocaleString()}
                </p>
                <pre>{graph.document}</pre>
                {graph.planningThreadId && (
                  <button
                    onClick={() => void openThread(graph.planningThreadId!)}
                  >
                    回到原生规划对话 <ArrowUpRight size={14} />
                  </button>
                )}
              </>
            ) : (
              <>
                <p>
                  尚未发布已确认的开发文档。请在原生 Codex 对话中调用
                  $project-graph，先讨论需求与实施方案。
                </p>
                <button onClick={() => void prepare()}>
                  在原生对话中规划 <ArrowUpRight size={14} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {searchOpen && (
        <div className="ng-overlay" onClick={() => setSearchOpen(false)}>
          <section
            className="ng-modal ng-search"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <strong>搜索「{project?.name}」的原生对话</strong>
              <button
                aria-label="关闭搜索"
                onClick={() => setSearchOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <input
              autoFocus
              placeholder="搜索标题、线程 ID…"
              aria-label="搜索项目对话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="ng-checkbox">
              <input
                type="checkbox"
                checked={history}
                onChange={(e) => setHistory(e.target.checked)}
              />
              同时搜索原生历史消息（仅当前项目，不消耗模型 tokens）
            </label>
            <small>
              {searchBusy ? "正在查询 Codex 历史…" : `${results.length} 段对话`}
            </small>
            <div className="ng-search-results">
              {results.map((t) => (
                <div className="ng-search-row" key={t.id}>
                  <button
                    className="ng-thread"
                    onClick={() => void openThread(t.id)}
                  >
                    <div>
                      <strong>{t.title}</strong>
                      <ArrowUpRight size={14} />
                    </div>
                    <code>{t.id}</code>
                    {t.snippet && <p>{t.snippet}</p>}
                  </button>
                  <select
                    aria-label={`${t.title}所属节点`}
                    value={
                      graph?.nodes.find((n) => n.threadIds.includes(t.id))
                        ?.id || ""
                    }
                    onChange={(e) =>
                      void mutate({
                        action: "assign",
                        threadId: t.id,
                        nodeId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">未分类</option>
                    {graph?.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.title}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {!searchBusy && !results.length && (
                <p className="ng-muted">当前项目没有匹配的对话。</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
