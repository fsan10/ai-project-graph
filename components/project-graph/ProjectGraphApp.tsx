"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowRight, Bot, Box, Braces, Check, CheckCircle2,
  ChevronDown, CircleDot, Code2, Copy, Database, FileCode2, FolderOpen,
  GitCommitHorizontal, GitFork, Layers3, Link2, LockKeyhole, Maximize2,
  MessageSquarePlus, MousePointer2, Network, PanelLeftClose, Pencil, Plus, Search,
  ShieldCheck, Sparkles, Trash2, Upload, Waypoints, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel,
  ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent,
  ContextMenuSubTrigger, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import {
  EDGE_TYPES, NODE_STATUSES, NODE_TYPES, acceptNode, addEvidence, bindConversation,
  compileContext, confirmBlueprint, createEdge, createNode, createProject, createSeedState,
  deleteEdge, moveNode, projectSnapshot, updateEdge, updateNode, updateNodeLayouts, validateGraph,
  type ArchitectureEdge, type ArchitectureNode, type Blueprint, type ConversationBinding,
  type EdgeType, type NodeStatus, type NodeType, type ProjectState,
} from "@/lib/domain";
import { nodesInMarquee, rangeSelection, rectFromPoints, type CanvasPoint } from "@/lib/canvas";

const LEGACY_STORAGE_KEY = "ai-project-graph:v1";
const PROJECTS_STORAGE_KEY = "ai-project-graph:projects:v2";
const ACTIVE_PROJECT_KEY = "ai-project-graph:active-project:v2";

const statusMeta: Record<NodeStatus, { label: string; short: string; className: string; dot: string }> = {
  planned: { label: "计划中", short: "计划", className: "status-planned", dot: "#8292a8" },
  in_progress: { label: "进行中", short: "进行中", className: "status-progress", dot: "#20b8a6" },
  in_review: { label: "待验收", short: "待验收", className: "status-review", dot: "#f2aa3d" },
  done: { label: "已完成", short: "已完成", className: "status-done", dot: "#68d391" },
  blocked: { label: "已阻塞", short: "阻塞", className: "status-blocked", dot: "#f87171" },
};

const nodeTypeLabels: Record<NodeType, string> = {
  system: "系统", domain: "领域", module: "模块", feature: "功能", service: "服务",
  database: "数据库", queue: "队列", external: "外部系统", process: "流程",
  data_pipeline: "数据管道", task: "任务",
};

const edgeTypeLabels: Record<EdgeType, string> = {
  contains: "包含", depends_on: "依赖", blocks: "阻塞", calls: "调用", reads: "读取",
  writes: "写入", produces: "产出", consumes: "消费", publishes: "发布",
  subscribes: "订阅", authenticates: "认证", related: "关联",
};

const conversationTypeLabels: Record<ConversationBinding["type"], string> = {
  architect: "架构设计", implementation: "实现", research: "研究", debug: "调试",
  review: "评审", side_chat: "侧聊",
};

const projectModeLabels: Record<ProjectState["project"]["mode"], string> = {
  greenfield: "新建项目", existing: "现有仓库", hybrid: "计划与现实并行",
};

const blueprintStatusLabels: Record<Blueprint["status"], string> = {
  draft: "草稿", confirmed: "已确认",
};

const layoutModeLabels: Record<ArchitectureNode["layoutMode"], string> = {
  auto: "自动布局", confirmed_auto: "已确认自动布局", manual: "手动布局",
};

const nodeIcons: Record<NodeType, typeof Box> = {
  system: Layers3, domain: Box, module: Braces, feature: Sparkles, service: Activity,
  database: Database, queue: Waypoints, external: Link2, process: GitFork,
  data_pipeline: Network, task: CheckCircle2,
};

type Lens = "architecture" | "dependency" | "progress" | "runtime" | "evidence";
type Theme = "light" | "dark";
type NodePositionMap = Record<string, { x: number; y: number }>;

interface DirectoryEntryLike {
  kind: "file" | "directory";
  name: string;
  getFile?: () => Promise<File>;
}

interface DirectoryHandleLike {
  name: string;
  values: () => AsyncIterable<DirectoryEntryLike>;
}

function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function normalizeState(value: unknown): ProjectState {
  if (!value || typeof value !== "object") throw new Error("文件不是有效的 AI 项目图谱快照。");
  const state = value as ProjectState;
  if (!state.project?.id || !Array.isArray(state.nodes) || !Array.isArray(state.edges)) {
    throw new Error("缺少 project、nodes 或 edges。");
  }
  return {
    ...state,
    blueprint: {
      ...state.blueprint,
      principles: state.blueprint.principles.map((item) => item === "Plan 与 Reality 分离" ? "计划与现实分离" : item),
      acceptanceDefinition: state.blueprint.acceptanceDefinition.map((item) => item === "用户人工验收后才算 Done" ? "用户人工验收后才算已完成" : item),
    },
    checkpoints: state.checkpoints.map((item) => ({ ...item, acceptedBy: item.acceptedBy === "User" ? "用户" : item.acceptedBy })),
  };
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function EmptyState({ icon: Icon, title, copy }: { icon: typeof Box; title: string; copy: string }) {
  return (
    <div className="empty-state">
      <Icon size={18} />
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function edgeVisible(edge: ArchitectureEdge, lens: Lens) {
  if (lens === "dependency") return edge.layer === "execution";
  if (lens === "runtime") return edge.layer === "runtime";
  return edge.layer === "structure" || edge.type === "depends_on";
}

function edgeColor(edge: ArchitectureEdge) {
  return edge.layer === "runtime" ? "#317cff" : edge.layer === "execution" ? "#c47a12" : "#7a7a80";
}

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

export function ProjectGraphApp() {
  const [state, setState] = useState<ProjectState>(() => createSeedState());
  const [projects, setProjects] = useState<ProjectState[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("auth.login");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(["auth.login"]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("architecture");
  const [search, setSearch] = useState("");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [view, setView] = useState({ x: 24, y: 28, zoom: 0.78 });
  const [theme, setTheme] = useState<Theme>("light");
  const [embedded, setEmbedded] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isDraggingNodes, setIsDraggingNodes] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [connectType, setConnectType] = useState<EdgeType>("depends_on");
  const [dragPreview, setDragPreview] = useState<NodePositionMap>({});
  const [marquee, setMarquee] = useState<{ start: CanvasPoint; current: CanvasPoint } | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<{ sourceNodeId: string; start: CanvasPoint; end: CanvasPoint } | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [newNodePosition, setNewNodePosition] = useState<CanvasPoint | null>(null);
  const [conversationDefaultType, setConversationDefaultType] = useState<ConversationBinding["type"]>("implementation");
  const [dialogs, setDialogs] = useState({
    project: false, node: false, conversation: false, evidence: false,
    blueprint: false, diagnostics: false,
  });
  const [blueprintDraft, setBlueprintDraft] = useState<Blueprint>(() => createSeedState().blueprint);
  const importRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const viewRef = useRef(view);
  const selectionAnchorRef = useRef("auth.login");
  const dragRef = useRef<{
    pointerX: number; pointerY: number; origins: NodePositionMap; latest: NodePositionMap; moved: boolean;
  } | null>(null);
  const panRef = useRef<{
    pointerX: number; pointerY: number; originX: number; originY: number;
  } | null>(null);
  const marqueeRef = useRef<{
    start: CanvasPoint; current: CanvasPoint; additive: string[];
  } | null>(null);
  const connectionRef = useRef<{ sourceNodeId: string; start: CanvasPoint; end: CanvasPoint } | null>(null);

  const setDialog = (name: keyof typeof dialogs, value: boolean) => {
    setDialogs((current) => ({ ...current, [name]: value }));
  };

  function clientToWorld(clientX: number, clientY: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const currentView = viewRef.current;
    return {
      x: (clientX - rect.left - currentView.x) / currentView.zoom,
      y: (clientY - rect.top - currentView.y) / currentView.zoom,
    };
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const savedProjects = localStorage.getItem(PROJECTS_STORAGE_KEY);
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        const restoredProjects = savedProjects
          ? (JSON.parse(savedProjects) as unknown[]).map(normalizeState)
          : legacy ? [normalizeState(JSON.parse(legacy))] : [createSeedState()];
        const activeId = localStorage.getItem(ACTIVE_PROJECT_KEY);
        const restored = restoredProjects.find((item) => item.project.id === activeId) ?? restoredProjects[0];
        setProjects(restoredProjects);
        setState(restored);
        setSelectedNodeId(restored.nodes[0]?.id ?? "");
        setSelectedNodeIds(restored.nodes[0] ? [restored.nodes[0].id] : []);
        selectionAnchorRef.current = restored.nodes[0]?.id ?? "";
        setBlueprintDraft(restored.blueprint);
      } catch {
        localStorage.removeItem(PROJECTS_STORAGE_KEY);
        toast.warning("本地数据损坏，已加载安全示例项目。");
      } finally {
        setHydrated(true);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let stored: ProjectState[] = [];
    try {
      stored = (JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY) ?? "[]") as unknown[]).map(normalizeState);
    } catch {
      stored = [];
    }
    const next = stored.some((item) => item.project.id === state.project.id)
      ? stored.map((item) => item.project.id === state.project.id ? state : item)
      : [...stored, state];
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next));
    localStorage.setItem(ACTIVE_PROJECT_KEY, state.project.id);
  }, [state, hydrated]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hostEmbedded = ["codex", "workbuddy", "deepseek-harness"].includes(query.get("host") ?? "");
    const queryTheme = query.get("theme");
    const initialTheme = queryTheme === "dark" || queryTheme === "light"
      ? queryTheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    queueMicrotask(() => {
      setEmbedded(hostEmbedded || window.parent !== window);
      setTheme(initialTheme);
    });
    window.parent.postMessage({ type: "ai-project-graph:frame-ready" }, "*");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = (event: MediaQueryListEvent) => setTheme(event.matches ? "dark" : "light");
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; theme?: Theme; project?: unknown } | null;
      if (!data) return;
      if (["ai-project-graph:theme", "taskboard:theme"].includes(data.type ?? "") && (data.theme === "light" || data.theme === "dark")) {
        setTheme(data.theme);
      }
      if (data.type === "ai-project-graph:project-selected" && data.project) {
        try {
          const next = normalizeState(data.project);
          setState(next);
          setSelectedNodeId(next.nodes[0]?.id ?? "");
          setSelectedNodeIds(next.nodes[0] ? [next.nodes[0].id] : []);
          setBlueprintDraft(next.blueprint);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "宿主返回的项目无效");
        }
      }
    };
    media.addEventListener("change", onMedia);
    window.addEventListener("message", onMessage);
    return () => {
      media.removeEventListener("change", onMedia);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (panRef.current) {
        setView((current) => ({
          ...current,
          x: panRef.current!.originX + event.clientX - panRef.current!.pointerX,
          y: panRef.current!.originY + event.clientY - panRef.current!.pointerY,
        }));
        return;
      }
      if (dragRef.current) {
        const deltaX = (event.clientX - dragRef.current.pointerX) / viewRef.current.zoom;
        const deltaY = (event.clientY - dragRef.current.pointerY) / viewRef.current.zoom;
        dragRef.current.moved ||= Math.abs(deltaX) + Math.abs(deltaY) > 2;
        dragRef.current.latest = Object.fromEntries(Object.entries(dragRef.current.origins).map(([id, origin]) => [
          id, { x: origin.x + deltaX, y: origin.y + deltaY },
        ]));
        setDragPreview(dragRef.current.latest);
        return;
      }
      if (marqueeRef.current) {
        const point = clientToWorld(event.clientX, event.clientY);
        marqueeRef.current.current = point;
        setMarquee({ start: marqueeRef.current.start, current: point });
        const ids = nodesInMarquee(stateRef.current.nodes, rectFromPoints(marqueeRef.current.start, point));
        const next = [...new Set([...marqueeRef.current.additive, ...ids])];
        setSelectedNodeIds(next);
        setSelectedNodeId(next.at(-1) ?? "");
        return;
      }
      if (connectionRef.current) {
        const point = clientToWorld(event.clientX, event.clientY);
        connectionRef.current.end = point;
        setConnectionPreview({ ...connectionRef.current });
      }
    };
    const up = (event: PointerEvent) => {
      if (dragRef.current) {
        const drag = dragRef.current;
        if (drag.moved) {
          setState((current) => updateNodeLayouts(
            current,
            Object.entries(drag.latest).map(([id, position]) => ({ id, ...position })),
            current.revision,
          ));
        }
      }
      if (connectionRef.current) {
        const sourceNodeId = connectionRef.current.sourceNodeId;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-node-id]");
        const targetNodeId = target?.dataset.nodeId;
        if (targetNodeId && targetNodeId !== sourceNodeId) {
          setState((current) => {
            try {
              const next = createEdge(current, sourceNodeId, targetNodeId, connectType, current.revision);
              toast.success("节点关系已创建");
              return next;
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "无法创建节点关系");
              return current;
            }
          });
        }
      }
      dragRef.current = null;
      panRef.current = null;
      marqueeRef.current = null;
      connectionRef.current = null;
      setIsDraggingNodes(false);
      setIsPanning(false);
      setDragPreview({});
      setMarquee(null);
      setConnectionPreview(null);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressed(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const ids = stateRef.current.nodes.map((node) => node.id);
        setSelectedNodeIds(ids);
        setSelectedNodeId(ids.at(-1) ?? "");
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedEdgeId) {
        event.preventDefault();
        setState((current) => deleteEdge(current, selectedEdgeId, current.revision));
        setSelectedEdgeId(null);
        toast.success("连线已删除");
      }
      if (event.key === "Escape") {
        setConnectMode(false);
        setConnectSource(null);
        setSelectedEdgeId(null);
        setMarquee(null);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    const blur = () => {
      setSpacePressed(false);
      setIsPanning(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    };
  }, [connectType, selectedEdgeId]);

  const selectedNode = state.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = state.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const diagnostics = useMemo(() => validateGraph(state), [state]);
  const snapshot = useMemo(() => projectSnapshot(state), [state]);
  const progress = Math.round(
    (state.nodes.filter((node) => node.status === "done").length / Math.max(1, state.nodes.length)) * 100,
  );
  const context = useMemo(() => {
    if (!selectedNode) return null;
    const thread = state.conversations.find((item) => item.nodeId === selectedNode.id)?.threadId;
    return compileContext(state, selectedNode.id, thread);
  }, [selectedNode, state]);
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return new Set(state.nodes.map((node) => node.id));
    return new Set(state.nodes.filter((node) => {
      const nodeMatch = [node.id, node.name, node.goal, ...node.acceptanceCriteria]
        .some((value) => value.toLowerCase().includes(term));
      const evidenceMatch = state.evidence.some((item) => item.nodeId === node.id && item.path.toLowerCase().includes(term));
      const conversationMatch = state.conversations.some((item) =>
        item.nodeId === node.id && (item.title + " " + item.summary).toLowerCase().includes(term),
      );
      return nodeMatch || evidenceMatch || conversationMatch;
    }).map((node) => node.id));
  }, [search, state]);

  const activateProject = (next: ProjectState) => {
    setProjects((current) => {
      const withCurrent = current.some((item) => item.project.id === state.project.id)
        ? current.map((item) => item.project.id === state.project.id ? state : item)
        : [...current, state];
      return withCurrent.some((item) => item.project.id === next.project.id)
        ? withCurrent.map((item) => item.project.id === next.project.id ? next : item)
        : [...withCurrent, next];
    });
    setState(next);
    setSelectedNodeId(next.nodes[0]?.id ?? "");
    setSelectedNodeIds(next.nodes[0] ? [next.nodes[0].id] : []);
    setSelectedEdgeId(null);
    selectionAnchorRef.current = next.nodes[0]?.id ?? "";
    setBlueprintDraft(next.blueprint);
    setView({ x: 24, y: 28, zoom: 0.78 });
  };

  const openNodeEditor = (nodeId: string | null, position?: CanvasPoint) => {
    setEditingNodeId(nodeId);
    setNewNodePosition(position ?? null);
    setDialog("node", true);
  };

  const selectNodeForPointer = (event: React.PointerEvent, nodeId: string) => {
    const order = state.nodes.map((node) => node.id);
    let next: string[];
    if (event.shiftKey) {
      next = rangeSelection(order, selectionAnchorRef.current, nodeId);
    } else if (event.ctrlKey || event.metaKey) {
      next = selectedNodeIds.includes(nodeId)
        ? selectedNodeIds.filter((id) => id !== nodeId)
        : [...selectedNodeIds, nodeId];
      selectionAnchorRef.current = nodeId;
    } else {
      next = selectedNodeIds.includes(nodeId) ? selectedNodeIds : [nodeId];
      selectionAnchorRef.current = nodeId;
    }
    setSelectedNodeIds(next);
    setSelectedNodeId(next.includes(nodeId) ? nodeId : next.at(-1) ?? "");
    setSelectedEdgeId(null);
    return next;
  };

  const startNodeDrag = (event: React.PointerEvent, node: ArchitectureNode) => {
    if (event.button !== 0 || connectMode || node.layoutLocked) return;
    event.stopPropagation();
    const nextSelection = selectNodeForPointer(event, node.id);
    if (!nextSelection.includes(node.id)) return;
    const origins = Object.fromEntries(state.nodes
      .filter((item) => nextSelection.includes(item.id) && !item.layoutLocked)
      .map((item) => [item.id, { x: item.x, y: item.y }]));
    if (!Object.keys(origins).length) return;
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      origins,
      latest: origins,
      moved: false,
    };
    setIsDraggingNodes(true);
  };

  const startConnection = (event: React.PointerEvent, node: ArchitectureNode, side: "top" | "right" | "bottom" | "left") => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = side === "top" ? { x: node.x + node.width / 2, y: node.y }
      : side === "right" ? { x: node.x + node.width, y: node.y + node.height / 2 }
        : side === "bottom" ? { x: node.x + node.width / 2, y: node.y + node.height }
          : { x: node.x, y: node.y + node.height / 2 };
    connectionRef.current = { sourceNodeId: node.id, start: point, end: point };
    setConnectionPreview({ ...connectionRef.current });
    setConnectSource(node.id);
    setSelectedNodeIds([node.id]);
    setSelectedNodeId(node.id);
  };

  const chooseProjectFolder = async () => {
    window.parent.postMessage({ type: "ai-project-graph:choose-project-folder" }, "*");
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    if (!picker) {
      toast.info(embedded ? "已请求 Codex 打开项目文件夹选择器" : "当前浏览器不支持文件夹选择，请使用导入项目文件");
      return;
    }
    try {
      const handle = await picker();
      for await (const entry of handle.values()) {
        if (entry.kind === "file" && entry.name.endsWith(".project-graph.json") && entry.getFile) {
          await importProject(await entry.getFile());
          return;
        }
      }
      const next = createProject({
        name: handle.name,
        goal: `维护 ${handle.name} 的软件架构、任务与会话`,
        workspacePath: handle.name,
        repositoryUrl: "",
        mode: "existing",
        modules: [],
      });
      activateProject(next);
      toast.success("已从文件夹创建项目，可继续完善项目蓝图");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "无法读取所选文件夹");
    }
  };

  const run = (action: () => ProjectState, success: string) => {
    try {
      setState(action());
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
      return false;
    }
  };

  const chooseNode = (nodeId: string) => {
    if (!connectMode) {
      setSelectedNodeId(nodeId);
      setSelectedNodeIds([nodeId]);
      setSelectedEdgeId(null);
      return;
    }
    if (!connectSource) {
      setConnectSource(nodeId);
      toast.info("请选择关系的目标节点。");
      return;
    }
    if (run(() => createEdge(state, connectSource, nodeId, connectType, state.revision), "关系已创建")) {
      setConnectMode(false);
      setConnectSource(null);
    }
  };

  const exportProject = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = state.project.id + ".project-graph.json";
    link.click();
    URL.revokeObjectURL(href);
    toast.success("项目快照已导出");
  };

  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      const next = normalizeState(JSON.parse(await file.text()));
      const errors = validateGraph(next).filter((item) => item.severity === "error");
      if (errors.length) throw new Error("导入被拒绝：发现 " + errors.length + " 个结构错误。");
      activateProject(next);
      toast.success("项目快照已安全导入");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法导入该文件");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const openConversation = async (conversation?: ConversationBinding) => {
    if (!conversation) return;
    window.dispatchEvent(new CustomEvent("ai-project-graph:open-conversation", { detail: conversation }));
    window.parent.postMessage({ type: "ai-project-graph:open-conversation", conversation }, "*");
    try {
      await navigator.clipboard.writeText(conversation.threadId);
      toast.success("已请求 Codex 桥接器打开会话，并复制会话标识");
    } catch {
      toast.info("会话标识：" + conversation.threadId);
    }
  };

  const editingNode = editingNodeId ? state.nodes.find((node) => node.id === editingNodeId) ?? null : null;

  return (
    <main className={cx("app-shell", embedded && "embedded")}>
      <Toaster position="top-center" richColors />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Network size={18} /></div>
          <div><strong>AI 项目图谱</strong><span>以架构为中心的 AI 编程工作台</span></div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="project-crumb" aria-label="切换项目">
              <span className="status-light" />
              <span className="project-crumb-copy"><strong>{state.project.name}</strong><span>{projectModeLabels[state.project.mode]} · 第 {state.graphVersion} 版</span></span>
              <ChevronDown size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="project-switcher-menu">
            <DropdownMenuLabel>当前项目</DropdownMenuLabel>
            <DropdownMenuItem disabled><Check />{state.project.name}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>其他项目</DropdownMenuLabel>
            {projects.filter((project) => project.project.id !== state.project.id).length ? projects
              .filter((project) => project.project.id !== state.project.id)
              .map((project) => (
                <DropdownMenuItem key={project.project.id} onSelect={() => activateProject(project)}>
                  <Network />{project.project.name}
                </DropdownMenuItem>
              )) : <DropdownMenuItem disabled>暂时没有其他项目</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void chooseProjectFolder()}><FolderOpen />选择项目文件夹</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog("project", true)}><Plus />新建项目</DropdownMenuItem>
            <DropdownMenuItem asChild><a href="/codex-project-graph.user.js" download><Layers3 />下载 Codex 菜单集成脚本</a></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="top-actions">
          <Badge variant="outline" className="revision-badge">修订 {state.revision}</Badge>
          <button className="diagnostic-pill" onClick={() => setDialog("diagnostics", true)}>
            {diagnostics.some((item) => item.severity === "error") ? <X size={13} /> : <Check size={13} />}
            {diagnostics.length ? diagnostics.length + " 个诊断项" : "图谱有效"}
          </button>
          <Button variant="ghost" size="sm" onClick={exportProject}><ArrowDownToLine />导出</Button>
          <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}><Upload />导入</Button>
          <input
            ref={importRef} type="file" accept="application/json,.json" hidden
            onChange={(event) => void importProject(event.target.files?.[0])}
          />
          <Button size="sm" onClick={() => {
            setBlueprintDraft(state.blueprint);
            setDialog("blueprint", true);
          }}><Sparkles />项目蓝图</Button>
        </div>
      </header>

      <section className={cx("workspace", leftCollapsed && "left-collapsed")}>
        <aside className="left-rail">
          <div className="rail-title-row">
            <span>项目空间</span>
            <button onClick={() => setLeftCollapsed(true)} aria-label="收起项目栏"><PanelLeftClose size={15} /></button>
          </div>
          <Dialog open={dialogs.project} onOpenChange={(value) => setDialog("project", value)}>
            <DialogTrigger asChild><Button className="new-project" variant="outline"><Plus />新建项目</Button></DialogTrigger>
            <DialogContent className="dialog-wide">
              <DialogHeader>
                <DialogTitle>创建 AI 项目图谱</DialogTitle>
                <DialogDescription>创建项目架构师、项目蓝图草稿和第一版稳定标识架构。</DialogDescription>
              </DialogHeader>
              <form id="new-project-form" className="form-grid" onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const name = String(data.get("name") ?? "").trim();
                const goal = String(data.get("goal") ?? "").trim();
                if (!name || !goal) return toast.error("项目名称和目标不能为空");
                const next = createProject({
                  name,
                  goal,
                  workspacePath: String(data.get("workspacePath") ?? ""),
                  repositoryUrl: String(data.get("repositoryUrl") ?? ""),
                  mode: String(data.get("mode") ?? "greenfield") as ProjectState["project"]["mode"],
                  modules: String(data.get("modules") ?? "").split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
                });
                activateProject(next);
                setDialog("project", false);
                setDialog("blueprint", true);
                toast.success("项目架构师与项目蓝图草稿已创建");
              }}>
                <FormField label="项目名称"><Input name="name" placeholder="例如：电商经营分析平台" autoFocus /></FormField>
                <FormField label="初始化模式">
                  <select name="mode" className="native-select">
                    <option value="greenfield">新建项目</option>
                    <option value="existing">现有仓库</option>
                    <option value="hybrid">计划与现实并行</option>
                  </select>
                </FormField>
                <FormField label="项目目标"><Textarea name="goal" placeholder="用一句话说明要构建什么，以及服务谁" /></FormField>
                <FormField label="主要模块" hint="用逗号或换行分隔，系统会为每个模块创建稳定 ID">
                  <Textarea name="modules" placeholder="身份认证，文件管理，数据处理，经营看板" />
                </FormField>
                <FormField label="工作区路径"><Input name="workspacePath" placeholder="D:/projects/commerce-platform" /></FormField>
                <FormField label="代码仓库地址"><Input name="repositoryUrl" placeholder="https://github.com/org/repo" /></FormField>
              </form>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog("project", false)}>取消</Button>
                <Button type="submit" form="new-project-form">创建并进入项目蓝图</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="rail-section">
            <span className="rail-label">总览</span>
            <button className="rail-item active"><Network /><span>架构</span><em>{state.nodes.length}</em></button>
            <button className="rail-item" onClick={() => setLens("progress")}><Activity /><span>项目状态</span><em>{progress}%</em></button>
            <button className="rail-item" onClick={() => setDialog("blueprint", true)}><FileCode2 /><span>项目蓝图</span><em>第 {state.graphVersion} 版</em></button>
          </div>

          <div className="rail-section conversations-list">
            <span className="rail-label">会话</span>
            <button
              className="rail-item architect"
              onClick={() => void openConversation(state.conversations.find((item) => item.type === "architect"))}
            ><Bot /><span>项目架构师</span><i /></button>
            {state.conversations.filter((item) => item.nodeId).slice(0, 5).map((conversation) => (
              <button className="conversation-row" key={conversation.id} onClick={() => {
                if (conversation.nodeId) setSelectedNodeId(conversation.nodeId);
                void openConversation(conversation);
              }}>
                <MessageSquarePlus size={13} />
                <span><strong>{conversation.title}</strong><small>{conversationTypeLabels[conversation.type]} · {conversation.threadId}</small></span>
              </button>
            ))}
          </div>
          <div className="rail-state-card">
            <div><span>项目状态</span><strong>{progress}%</strong></div>
            <Progress value={progress} />
            <p>
              <CheckCircle2 />{snapshot.completedNodes.length} 已完成
              <CircleDot />{snapshot.activeNodes.length} 进行中
              <LockKeyhole />{snapshot.blockedNodes.length} 阻塞
            </p>
          </div>
        </aside>

        {leftCollapsed ? (
          <button className="open-left" onClick={() => setLeftCollapsed(false)} aria-label="展开项目栏">
            <Layers3 size={16} />
          </button>
        ) : null}

        <section className="canvas-column">
          <div className="canvas-toolbar">
            <div className="search-box">
              <Search size={15} />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索节点、接口、文件或会话" />
              <kbd>⌘K</kbd>
            </div>
            <div className="toolbar-divider" />
            <Dialog open={dialogs.node} onOpenChange={(value) => {
              setDialog("node", value);
              if (!value) {
                setEditingNodeId(null);
                setNewNodePosition(null);
              }
            }}>
              <Button size="sm" variant="outline" onClick={() => openNodeEditor(null)}><Plus />节点</Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingNode ? "编辑架构节点" : "添加架构节点"}</DialogTitle>
                  <DialogDescription>{editingNode ? "可调整名称、类型、目标、父节点与布局锁定状态。" : "稳定标识创建后不可变；名称和位置可以持续调整。"}</DialogDescription>
                </DialogHeader>
                <form key={editingNode?.id ?? `new-${newNodePosition?.x ?? "toolbar"}-${newNodePosition?.y ?? "toolbar"}`} id="node-form" className="form-grid" onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const id = editingNode?.id ?? String(data.get("id") ?? "").trim();
                  const name = String(data.get("name") ?? "").trim();
                  if (!id || !name) return toast.error("稳定标识和名称不能为空");
                  const input = {
                    name,
                    type: String(data.get("type")) as NodeType,
                    parentId: String(data.get("parentId") || "") || null,
                    goal: String(data.get("goal") || "交付" + name),
                    layoutLocked: data.get("layoutLocked") === "on",
                  };
                  const ok = editingNode
                    ? run(() => updateNode(state, editingNode.id, input, state.revision), "节点已更新")
                    : run(() => createNode(state, {
                      id,
                      ...input,
                      x: newNodePosition?.x ?? 460,
                      y: newNodePosition?.y ?? 280,
                    }, state.revision), "节点已创建");
                  if (ok) {
                    setSelectedNodeId(id);
                    setSelectedNodeIds([id]);
                    setDialog("node", false);
                    setEditingNodeId(null);
                    setNewNodePosition(null);
                  }
                }}>
                  <FormField label="稳定标识" hint="示例：auth.password-reset"><Input name="id" placeholder="domain.feature" defaultValue={editingNode?.id} disabled={Boolean(editingNode)} autoFocus={!editingNode} /></FormField>
                  <FormField label="节点名称"><Input name="name" placeholder="密码重置" defaultValue={editingNode?.name} autoFocus={Boolean(editingNode)} /></FormField>
                  <FormField label="类型">
                    <select name="type" className="native-select" defaultValue={editingNode?.type ?? "system"}>
                      {NODE_TYPES.map((type) => <option key={type} value={type}>{nodeTypeLabels[type]}</option>)}
                    </select>
                  </FormField>
                  <FormField label="父节点">
                    <select name="parentId" className="native-select" defaultValue={editingNode?.parentId ?? ""}>
                      <option value="">无</option>
                      {state.nodes.filter((node) => node.id !== editingNode?.id).map((node) => <option value={node.id} key={node.id}>{node.name} · {node.id}</option>)}
                    </select>
                  </FormField>
                  <FormField label="目标"><Textarea name="goal" placeholder="该节点最终需要交付什么" defaultValue={editingNode?.goal} /></FormField>
                  <label className="checkbox-field"><input name="layoutLocked" type="checkbox" defaultChecked={editingNode?.layoutLocked} /><span>锁定节点位置</span></label>
                </form>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialog("node", false)}>取消</Button>
                  <Button form="node-form" type="submit">{editingNode ? "保存修改" : "创建节点"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Select value={connectType} onValueChange={(value) => setConnectType(value as EdgeType)}>
              <SelectTrigger size="sm" className="edge-select"><SelectValue /></SelectTrigger>
              <SelectContent>{EDGE_TYPES.map((type) => <SelectItem key={type} value={type}>{edgeTypeLabels[type]}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant={connectMode ? "default" : "outline"} onClick={() => {
              setConnectMode((current) => !current);
              setConnectSource(null);
            }}><Link2 />{connectSource ? "选择目标" : "连接"}</Button>
            <div className="toolbar-divider" />
            <Button size="icon-sm" variant="ghost" aria-label="放大" onClick={() =>
              setView((current) => ({ ...current, zoom: Math.min(1.5, current.zoom + 0.1) }))
            }><ZoomIn /></Button>
            <span className="zoom-value">{Math.round(view.zoom * 100)}%</span>
            <Button size="icon-sm" variant="ghost" aria-label="缩小" onClick={() =>
              setView((current) => ({ ...current, zoom: Math.max(0.35, current.zoom - 0.1) }))
            }><ZoomOut /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="重置视图" onClick={() =>
              setView({ x: 24, y: 28, zoom: 0.78 })
            }><Maximize2 /></Button>
          </div>

          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={cx(
                  "graph-canvas",
                  connectMode && "connecting",
                  spacePressed && "space-pan",
                  isPanning && "panning",
                  isDraggingNodes && "dragging-nodes",
                )}
                ref={canvasRef}
                onPointerDownCapture={(event) => {
                  if (!spacePressed || event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  panRef.current = {
                    pointerX: event.clientX, pointerY: event.clientY, originX: view.x, originY: view.y,
                  };
                  setIsPanning(true);
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || spacePressed) return;
                  if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest(".canvas-grid")) return;
                  const start = clientToWorld(event.clientX, event.clientY);
                  const additive = event.ctrlKey || event.metaKey ? selectedNodeIds : [];
                  marqueeRef.current = { start, current: start, additive };
                  setMarquee({ start, current: start });
                  setSelectedEdgeId(null);
                  if (!additive.length) {
                    setSelectedNodeIds([]);
                    setSelectedNodeId("");
                  }
                }}
                onContextMenu={(event) => setNewNodePosition(clientToWorld(event.clientX, event.clientY))}
                onWheel={(event) => {
                  event.preventDefault();
                  const rect = canvasRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  const nextZoom = Math.min(1.5, Math.max(0.35, view.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
                  const pointerX = event.clientX - rect.left;
                  const pointerY = event.clientY - rect.top;
                  const worldX = (pointerX - view.x) / view.zoom;
                  const worldY = (pointerY - view.y) / view.zoom;
                  setView({ zoom: nextZoom, x: pointerX - worldX * nextZoom, y: pointerY - worldY * nextZoom });
                }}
              >
                <div className="canvas-grid" />
                <div className="canvas-world" style={{
                  transform: "translate(" + view.x + "px, " + view.y + "px) scale(" + view.zoom + ")",
                }}>
                  <svg className="edge-layer" width="1450" height="900" aria-label="节点关系连线">
                    <defs>
                      <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
                      </marker>
                    </defs>
                    {state.edges.filter((edge) => edgeVisible(edge, lens)).map((edge) => {
                      const source = state.nodes.find((node) => node.id === edge.sourceNodeId);
                      const target = state.nodes.find((node) => node.id === edge.targetNodeId);
                      if (!source || !target) return null;
                      const sourcePos = dragPreview[source.id] ?? source;
                      const targetPos = dragPreview[target.id] ?? target;
                      const sourceCenter = { x: sourcePos.x + source.width / 2, y: sourcePos.y + source.height / 2 };
                      const targetCenter = { x: targetPos.x + target.width / 2, y: targetPos.y + target.height / 2 };
                      const horizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);
                      const x1 = horizontal ? sourcePos.x + (targetCenter.x >= sourceCenter.x ? source.width : 0) : sourceCenter.x;
                      const y1 = horizontal ? sourceCenter.y : sourcePos.y + (targetCenter.y >= sourceCenter.y ? source.height : 0);
                      const x2 = horizontal ? targetPos.x + (targetCenter.x >= sourceCenter.x ? 0 : target.width) : targetCenter.x;
                      const y2 = horizontal ? targetCenter.y : targetPos.y + (targetCenter.y >= sourceCenter.y ? 0 : target.height);
                      const control = horizontal ? Math.max(55, Math.abs(x2 - x1) / 2) : Math.max(55, Math.abs(y2 - y1) / 2);
                      const path = horizontal
                        ? `M ${x1} ${y1} C ${x1 + Math.sign(x2 - x1) * control} ${y1}, ${x2 - Math.sign(x2 - x1) * control} ${y2}, ${x2} ${y2}`
                        : `M ${x1} ${y1} C ${x1} ${y1 + Math.sign(y2 - y1) * control}, ${x2} ${y2 - Math.sign(y2 - y1) * control}, ${x2} ${y2}`;
                      const labelX = (x1 + x2) / 2;
                      const labelY = (y1 + y2) / 2 - 7;
                      return (
                        <g key={edge.id} className={cx("edge-group", selectedEdgeId === edge.id && "selected")}>
                          <path
                            className="edge-hit"
                            d={path}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              setSelectedEdgeId(edge.id);
                              setSelectedNodeIds([]);
                              setSelectedNodeId("");
                            }}
                          />
                          <path className="edge-line" d={path} stroke={edgeColor(edge)} markerEnd="url(#arrow)" />
                          <text x={labelX} y={labelY}>{edgeTypeLabels[edge.type] ?? edge.label}</text>
                        </g>
                      );
                    })}
                    {connectionPreview ? (
                      <path
                        className="connection-preview"
                        d={`M ${connectionPreview.start.x} ${connectionPreview.start.y} L ${connectionPreview.end.x} ${connectionPreview.end.y}`}
                        markerEnd="url(#arrow)"
                      />
                    ) : null}
                  </svg>
                  {marquee ? (() => {
                    const rect = rectFromPoints(marquee.start, marquee.current);
                    return <div className="selection-marquee" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />;
                  })() : null}
                  {state.nodes.map((node) => (
                    <ContextMenu key={node.id} onOpenChange={(open) => {
                      if (open && !selectedNodeIds.includes(node.id)) {
                        setSelectedNodeIds([node.id]);
                        setSelectedNodeId(node.id);
                        setSelectedEdgeId(null);
                      }
                    }}>
                      <ContextMenuTrigger asChild>
                        <GraphNode
                          node={node}
                          selected={selectedNodeIds.includes(node.id)}
                          matched={matches.has(node.id)}
                          connecting={connectSource === node.id}
                          dragging={isDraggingNodes && selectedNodeIds.includes(node.id)}
                          position={dragPreview[node.id] ?? node}
                          evidenceCount={state.evidence.filter((item) =>
                            item.nodeId === node.id && item.verificationStatus === "verified",
                          ).length}
                          onClick={() => {
                            if (connectMode) chooseNode(node.id);
                          }}
                          onPointerDown={(event) => startNodeDrag(event, node)}
                          onStartConnection={(event, side) => startConnection(event, node, side)}
                        />
                      </ContextMenuTrigger>
                      <ContextMenuContent className="node-context-menu">
                        <ContextMenuLabel>{node.name}</ContextMenuLabel>
                        <ContextMenuItem onSelect={() => {
                          setConversationDefaultType("implementation");
                          setDialog("conversation", true);
                        }}><MessageSquarePlus />新建实现会话</ContextMenuItem>
                        <ContextMenuItem onSelect={() => {
                          setConversationDefaultType("side_chat");
                          setDialog("conversation", true);
                        }}><Bot />新建临时会话</ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => openNodeEditor(node.id)}><Pencil />编辑节点</ContextMenuItem>
                        <ContextMenuItem onSelect={() => setDialog("evidence", true)}><ShieldCheck />添加代码证据</ContextMenuItem>
                        <ContextMenuItem onSelect={() => {
                          setConnectMode(true);
                          setConnectSource(node.id);
                          toast.info("请选择关系的目标节点，或从节点连接点拖动");
                        }}><Link2 />从此节点创建关系</ContextMenuItem>
                        <ContextMenuSub>
                          <ContextMenuSubTrigger><Activity />设置节点状态</ContextMenuSubTrigger>
                          <ContextMenuSubContent>
                            {NODE_STATUSES.filter((status) => status !== "done").map((status) => (
                              <ContextMenuItem key={status} disabled={node.status === status} onSelect={() => run(
                                () => moveNode(state, node.id, status, state.revision, "agent"),
                                "状态已更新为" + statusMeta[status].label,
                              )}>{statusMeta[status].label}</ContextMenuItem>
                            ))}
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => run(
                          () => updateNode(state, node.id, { layoutLocked: !node.layoutLocked }, state.revision),
                          node.layoutLocked ? "节点位置已解锁" : "节点位置已锁定",
                        )}><LockKeyhole />{node.layoutLocked ? "解锁节点位置" : "锁定节点位置"}</ContextMenuItem>
                        <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(node.stableKey)}><Copy />复制稳定标识</ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
                {selectedEdge ? (
                  <div className="edge-inspector">
                    <span><Link2 />关系</span>
                    <strong>{state.nodes.find((node) => node.id === selectedEdge.sourceNodeId)?.name} → {state.nodes.find((node) => node.id === selectedEdge.targetNodeId)?.name}</strong>
                    <Select value={selectedEdge.type} onValueChange={(value) => run(
                      () => updateEdge(state, selectedEdge.id, value as EdgeType, state.revision),
                      "关系类型已更新",
                    )}>
                      <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                      <SelectContent>{EDGE_TYPES.map((type) => <SelectItem key={type} value={type}>{edgeTypeLabels[type]}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="icon-sm" variant="ghost" aria-label="删除连线" onClick={() => {
                      if (run(() => deleteEdge(state, selectedEdge.id, state.revision), "连线已删除")) setSelectedEdgeId(null);
                    }}><Trash2 /></Button>
                  </div>
                ) : null}
                <div className="canvas-hint"><MousePointer2 size={13} />拖动空白处框选 · Ctrl 单击多选 · Shift 单击连续选择 · 按住空格拖动画布</div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="canvas-context-menu">
              <ContextMenuLabel>画布操作</ContextMenuLabel>
              <ContextMenuItem onSelect={() => openNodeEditor(null, newNodePosition ?? undefined)}><Plus />在此新建节点</ContextMenuItem>
              <ContextMenuItem onSelect={() => {
                const ids = state.nodes.map((node) => node.id);
                setSelectedNodeIds(ids);
                setSelectedNodeId(ids.at(-1) ?? "");
              }}><MousePointer2 />选择全部节点<ContextMenuShortcut>Ctrl A</ContextMenuShortcut></ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => setView({ x: 24, y: 28, zoom: 0.78 })}><Maximize2 />重置视图</ContextMenuItem>
              <ContextMenuItem onSelect={() => {
                setBlueprintDraft(state.blueprint);
                setDialog("blueprint", true);
              }}><Sparkles />打开项目蓝图</ContextMenuItem>
              <ContextMenuItem onSelect={() => setDialog("diagnostics", true)}><ShieldCheck />运行图谱诊断</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <Tabs value={lens} onValueChange={(value) => setLens(value as Lens)} className="lens-tabs">
            <TabsList variant="line">
              <TabsTrigger value="architecture"><Network />架构</TabsTrigger>
              <TabsTrigger value="dependency"><GitFork />依赖</TabsTrigger>
              <TabsTrigger value="progress"><Activity />进度</TabsTrigger>
              <TabsTrigger value="runtime"><Waypoints />运行时</TabsTrigger>
              <TabsTrigger value="evidence"><ShieldCheck />证据</TabsTrigger>
            </TabsList>
          </Tabs>
        </section>

        <DetailPanel
          state={state}
          node={selectedNode}
          context={context}
          onSelectNode={setSelectedNodeId}
          onOpenConversation={(conversation) => void openConversation(conversation)}
          onNewConversation={() => {
            setConversationDefaultType("implementation");
            setDialog("conversation", true);
          }}
          onNewEvidence={() => setDialog("evidence", true)}
          onMove={(status) => {
            if (selectedNode) run(
              () => moveNode(state, selectedNode.id, status, state.revision, "agent"),
              "状态已更新为 " + statusMeta[status].label,
            );
          }}
          onUpdateGoal={(goal) => {
            if (selectedNode && goal !== selectedNode.goal) {
              run(() => updateNode(state, selectedNode.id, { goal }, state.revision), "目标已更新");
            }
          }}
          onAccept={() => {
            if (selectedNode) run(
              () => acceptNode(state, selectedNode.id, state.revision),
              "已创建检查点，已更新项目状态",
            );
          }}
        />
      </section>

      <ConversationDialog
        open={dialogs.conversation}
        onOpenChange={(value) => setDialog("conversation", value)}
        state={state}
        node={selectedNode}
        defaultType={conversationDefaultType}
        onCreate={(input) => {
          if (!selectedNode) return;
          const ok = run(
            () => bindConversation(state, selectedNode.id, input, state.revision),
            "会话已绑定到节点",
          );
          if (ok) setDialog("conversation", false);
        }}
      />
      <EvidenceDialog
        open={dialogs.evidence}
        onOpenChange={(value) => setDialog("evidence", value)}
        state={state}
        node={selectedNode}
        onCreate={(input) => {
          if (!selectedNode) return;
          const ok = run(
            () => addEvidence(state, selectedNode.id, input, state.revision),
            "代码证据已校验并绑定",
          );
          if (ok) setDialog("evidence", false);
        }}
      />
      <BlueprintDialog
        open={dialogs.blueprint}
        onOpenChange={(value) => setDialog("blueprint", value)}
        state={state}
        draft={blueprintDraft}
        onDraftChange={setBlueprintDraft}
        onConfirm={() => {
          const ok = run(
            () => confirmBlueprint(state, blueprintDraft, state.revision),
            "项目蓝图已确认，架构第 " + (state.graphVersion + 1) + " 版",
          );
          if (ok) setDialog("blueprint", false);
        }}
      />
      <DiagnosticsDialog
        open={dialogs.diagnostics}
        onOpenChange={(value) => setDialog("diagnostics", value)}
        diagnostics={diagnostics}
      />
    </main>
  );
}

function GraphNode({
  node, selected, matched, connecting, dragging, position, evidenceCount, onClick, onPointerDown, onStartConnection,
}: {
  node: ArchitectureNode;
  selected: boolean;
  matched: boolean;
  connecting: boolean;
  dragging: boolean;
  position: { x: number; y: number };
  evidenceCount: number;
  onClick: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onStartConnection: (event: React.PointerEvent<HTMLButtonElement>, side: "top" | "right" | "bottom" | "left") => void;
}) {
  const Icon = nodeIcons[node.type];
  return (
    <div
      role="button"
      tabIndex={0}
      data-node-id={node.id}
      aria-label={`${node.name}，${statusMeta[node.status].label}`}
      className={cx(
        "graph-node", statusMeta[node.status].className, selected && "selected",
        !matched && "dimmed", connecting && "connect-source", dragging && "dragging",
      )}
      style={{ left: position.x, top: position.y, width: node.width, height: node.height }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <button
          key={side}
          type="button"
          className={`connection-handle ${side}`}
          aria-label={`从${side === "top" ? "上方" : side === "right" ? "右侧" : side === "bottom" ? "下方" : "左侧"}创建连线`}
          onPointerDown={(event) => onStartConnection(event, side)}
        />
      ))}
      <span className="node-top">
        <span className="node-icon"><Icon size={15} /></span>
        <Badge variant="outline">{nodeTypeLabels[node.type]}</Badge>
        <i style={{ background: statusMeta[node.status].dot }} />
      </span>
      <strong>{node.name}</strong>
      <small>{node.stableKey}</small>
      <span className="node-bottom">
        <span>{statusMeta[node.status].label}</span>
        {evidenceCount ? <em><ShieldCheck size={12} />{evidenceCount}</em> : <em className="muted-evidence">暂无证据</em>}
      </span>
    </div>
  );
}

function DetailPanel({
  state, node, context, onSelectNode, onOpenConversation, onNewConversation,
  onNewEvidence, onMove, onUpdateGoal, onAccept,
}: {
  state: ProjectState;
  node: ArchitectureNode | null;
  context: ReturnType<typeof compileContext> | null;
  onSelectNode: (id: string) => void;
  onOpenConversation: (conversation: ConversationBinding) => void;
  onNewConversation: () => void;
  onNewEvidence: () => void;
  onMove: (status: NodeStatus) => void;
  onUpdateGoal: (goal: string) => void;
  onAccept: () => void;
}) {
  if (!node) return <aside className="detail-panel"><EmptyState icon={Network} title="选择一个节点" copy="节点详情会显示在这里。" /></aside>;
  const Icon = nodeIcons[node.type];
  const evidence = state.evidence.filter((item) => item.nodeId === node.id);
  const conversations = state.conversations.filter((item) => item.nodeId === node.id);
  const checkpoints = state.checkpoints.filter((item) => item.nodeId === node.id);
  return (
    <aside className="detail-panel">
      <div className="detail-hero">
        <div className="detail-icon"><Icon /></div>
        <div><Badge variant="outline">{nodeTypeLabels[node.type]}</Badge><h2>{node.name}</h2><code>{node.stableKey}</code></div>
      </div>
      <div className="detail-status-row">
        <span>状态</span>
        {node.status === "done" ? (
          <Badge className="done-badge"><CheckCircle2 />已完成 · 用户已验收</Badge>
        ) : (
          <Select value={node.status} onValueChange={(value) => onMove(value as NodeStatus)}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NODE_STATUSES.filter((status) => status !== "done").map((status) =>
                <SelectItem key={status} value={status}>{statusMeta[status].label}</SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </div>
      <Tabs defaultValue="overview" className="detail-tabs">
        <TabsList variant="line">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="context">上下文</TabsTrigger>
          <TabsTrigger value="history">历史</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="detail-scroll">
          <section className="detail-section editable-section">
            <div className="section-heading"><span>目标</span><small>版本 {node.version}</small></div>
            <Textarea
              key={node.id + "-" + node.version}
              defaultValue={node.goal}
              onBlur={(event) => onUpdateGoal(event.target.value)}
            />
          </section>
          <section className="detail-section">
            <div className="section-heading"><span>验收标准</span><small>{node.acceptanceCriteria.length} 项</small></div>
            <ul className="check-list">
              {node.acceptanceCriteria.map((item, index) => <li key={item + index}><CircleDot />{item}</li>)}
            </ul>
          </section>
          <section className="detail-section">
            <div className="section-heading"><span>依赖项</span></div>
            <div className="dependency-list">
              {context?.dependencies.length ? context.dependencies.map((dependency) => (
                <button key={dependency.id} onClick={() => onSelectNode(dependency.id)}>
                  <span className="dependency-icon"><Database /></span>
                  <span><strong>{dependency.name}</strong><small>{dependency.id}</small></span>
                  <Badge className={statusMeta[dependency.status].className}>{statusMeta[dependency.status].short}</Badge>
                </button>
              )) : <EmptyState icon={GitFork} title="没有直接依赖" copy="使用连接模式添加阻塞或依赖关系。" />}
            </div>
          </section>
          <section className="detail-section">
            <div className="section-heading">
              <span>代码证据</span>
              <Button variant="ghost" size="xs" onClick={onNewEvidence}><Plus />添加</Button>
            </div>
            <div className="evidence-list">
              {evidence.map((item) => (
                <div key={item.id} className={cx("evidence-row", item.verificationStatus)}>
                  <FileCode2 />
                  <span>
                    <strong>{item.path || "无效来源"}</strong>
                    <small>{item.startLine ? "第 " + item.startLine + "–" + item.endLine + " 行" : "未指定行范围"} · {item.commitSha?.slice(0, 8) || "无提交记录"}</small>
                  </span>
                  {item.verificationStatus === "verified" ? <ShieldCheck /> : <X />}
                </div>
              ))}
              {!evidence.length ? <EmptyState icon={FileCode2} title="尚无代码证据" copy="绑定相对路径、行号与 40 位提交哈希。" /> : null}
            </div>
          </section>
          <section className="detail-section">
            <div className="section-heading">
              <span>会话</span>
              <Button variant="ghost" size="xs" onClick={onNewConversation}><MessageSquarePlus />新建</Button>
            </div>
            <div className="conversation-cards">
              {conversations.map((conversation) => (
                <button key={conversation.id} onClick={() => onOpenConversation(conversation)}>
                  <span className={cx("conversation-kind", conversation.type)}><Bot /></span>
                  <span><strong>{conversation.title}</strong><small>{conversationTypeLabels[conversation.type]} · {formatDate(conversation.updatedAt)}</small></span>
                  <ArrowRight />
                </button>
              ))}
              {!conversations.length ? <EmptyState icon={MessageSquarePlus} title="没有关联会话" copy="新会话只加载最小事实集。" /> : null}
            </div>
          </section>
          {node.status === "in_review" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild><Button className="accept-button"><CheckCircle2 />确认并完成</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认完成「{node.name}」？</AlertDialogTitle>
                  <AlertDialogDescription>
                    系统将创建完成检查点，记录实现、证据、会话、分支和人工验收时间，并更新项目状态。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>继续检查</AlertDialogCancel>
                  <AlertDialogAction onClick={onAccept}>确认验收完成</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </TabsContent>
        <TabsContent value="context" className="detail-scroll">
          <div className="context-header">
            <div><Code2 /><span><strong>上下文编译器</strong><small>全局 + 依赖 + 节点 + 当前会话</small></span></div>
            <Badge variant="outline">{JSON.stringify(context).length} 字符</Badge>
          </div>
          <pre className="context-code">{JSON.stringify(context, null, 2)}</pre>
        </TabsContent>
        <TabsContent value="history" className="detail-scroll">
          <section className="detail-section">
            <div className="section-heading"><span>检查点</span></div>
            <div className="timeline">
              {checkpoints.map((item) => (
                <article key={item.id}>
                  <i />
                  <div>
                    <strong>{item.summary}</strong>
                    <small>{formatDate(item.acceptedAt)} · {item.acceptedBy === "User" ? "用户" : item.acceptedBy}</small>
                    <p>{item.implementation}</p>
                    <code>{item.commitSha.slice(0, 10)}</code>
                  </div>
                </article>
              ))}
              {!checkpoints.length ? <EmptyState icon={GitCommitHorizontal} title="尚无检查点" copy="人工验收完成后自动生成。" /> : null}
            </div>
          </section>
          <section className="detail-section">
            <div className="section-heading"><span>布局信息</span></div>
            <dl className="fact-grid">
              <div><dt>布局模式</dt><dd>{layoutModeLabels[node.layoutMode]}</dd></div>
              <div><dt>位置</dt><dd>{Math.round(node.x)}, {Math.round(node.y)}</dd></div>
              <div><dt>已锁定</dt><dd>{node.layoutLocked ? "是" : "否"}</dd></div>
              <div><dt>节点版本</dt><dd>{node.version}</dd></div>
            </dl>
          </section>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function ConversationDialog({
  open, onOpenChange, state, node, defaultType, onCreate,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  state: ProjectState;
  node: ArchitectureNode | null;
  defaultType: ConversationBinding["type"];
  onCreate: (input: Partial<ConversationBinding>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{defaultType === "side_chat" ? "新建临时会话" : "新建节点会话"}</DialogTitle>
          <DialogDescription>保存完整 Codex 绑定信息；新会话只编译当前节点相关上下文。</DialogDescription>
        </DialogHeader>
        <form key={`${node?.id}-${defaultType}-${open}`} id="conversation-form" className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onCreate({
            title: String(data.get("title") ?? ""),
            type: String(data.get("type")) as ConversationBinding["type"],
            role: "implementation",
            threadId: String(data.get("threadId") ?? ""),
            codexProjectId: String(data.get("codexProjectId") ?? ""),
            codexProjectKind: "workspace",
            codexHostId: String(data.get("codexHostId") ?? "local"),
            workspacePath: String(data.get("workspacePath") ?? state.project.workspacePath),
            summary: String(data.get("summary") ?? ""),
          });
        }}>
          <FormField label="节点"><Input value={node?.name ?? ""} disabled /></FormField>
          <FormField label="标题"><Input name="title" placeholder="实现登录失败重试" autoFocus /></FormField>
          <FormField label="类型">
            <select className="native-select" name="type" defaultValue={defaultType}>
              <option value="implementation">实现</option><option value="research">研究</option>
              <option value="debug">调试</option><option value="review">评审</option><option value="side_chat">侧聊</option>
            </select>
          </FormField>
          <FormField label="Codex 会话标识"><Input name="threadId" placeholder="thr_..." required /></FormField>
          <FormField label="Codex 项目标识"><Input name="codexProjectId" defaultValue={state.project.id} /></FormField>
          <FormField label="Codex 宿主标识"><Input name="codexHostId" defaultValue="local" /></FormField>
          <FormField label="工作区"><Input name="workspacePath" defaultValue={state.project.workspacePath} /></FormField>
          <FormField label="当前摘要"><Textarea name="summary" placeholder="可稍后由智能体更新" /></FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="submit" form="conversation-form">绑定并编译上下文</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EvidenceDialog({
  open, onOpenChange, state, node, onCreate,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  state: ProjectState;
  node: ArchitectureNode | null;
  onCreate: (input: Parameters<typeof addEvidence>[2]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定代码仓库证据</DialogTitle>
          <DialogDescription>默认拒绝：路径、行号或 40 位提交哈希无效时不会显示“已验证”。</DialogDescription>
        </DialogHeader>
        <form id="evidence-form" className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onCreate({
            type: "code",
            repositoryUrl: String(data.get("repositoryUrl") ?? ""),
            path: String(data.get("path") ?? ""),
            startLine: Number(data.get("startLine")),
            endLine: Number(data.get("endLine")),
            commitSha: String(data.get("commitSha") ?? ""),
          });
        }}>
          <FormField label="节点"><Input value={node?.name ?? ""} disabled /></FormField>
          <FormField label="代码仓库地址"><Input name="repositoryUrl" defaultValue={state.project.repositoryUrl} /></FormField>
          <FormField label="相对路径"><Input name="path" placeholder="server/auth/router.ts" required /></FormField>
          <div className="two-columns">
            <FormField label="起始行号"><Input name="startLine" type="number" min="1" defaultValue="1" /></FormField>
            <FormField label="结束行号"><Input name="endLine" type="number" min="1" defaultValue="1" /></FormField>
          </div>
          <FormField label="40 位提交哈希">
            <Input name="commitSha" placeholder="71ab43f8d3d3f8d0fdc9c04d018e902a48d7af11" required />
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="submit" form="evidence-form">验证并绑定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BlueprintDialog({
  open, onOpenChange, state, draft, onDraftChange, onConfirm,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  state: ProjectState;
  draft: Blueprint;
  onDraftChange: (draft: Blueprint) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="blueprint-dialog">
        <DialogHeader>
          <DialogTitle>项目蓝图</DialogTitle>
          <DialogDescription>用户确认的结构化项目合同，不是聊天摘要。确认后生成新的图谱版本。</DialogDescription>
        </DialogHeader>
        <div className="blueprint-status">
          <Badge className={draft.status === "confirmed" ? "done-badge" : "status-review"}>{blueprintStatusLabels[draft.status]}</Badge>
          <span>项目架构师 · {state.project.architectThreadId}</span>
        </div>
        <div className="blueprint-grid">
          <FormField label="项目目标"><Textarea value={draft.goal} onChange={(event) => onDraftChange({ ...draft, goal: event.target.value })} /></FormField>
          <FormField label="技术栈" hint="每行一个技术"><Textarea value={draft.techStack.join("\n")} onChange={(event) => onDraftChange({ ...draft, techStack: event.target.value.split("\n").filter(Boolean) })} /></FormField>
          <FormField label="主要模块"><Textarea value={draft.majorModules.join("\n")} onChange={(event) => onDraftChange({ ...draft, majorModules: event.target.value.split("\n").filter(Boolean) })} /></FormField>
          <FormField label="约束条件"><Textarea value={draft.constraints.join("\n")} onChange={(event) => onDraftChange({ ...draft, constraints: event.target.value.split("\n").filter(Boolean) })} /></FormField>
          <FormField label="安全策略"><Textarea value={draft.securityStrategy} onChange={(event) => onDraftChange({ ...draft, securityStrategy: event.target.value })} /></FormField>
          <FormField label="部署策略"><Textarea value={draft.deploymentStrategy} onChange={(event) => onDraftChange({ ...draft, deploymentStrategy: event.target.value })} /></FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>稍后确认</Button>
          <Button onClick={onConfirm}><Check />确认项目蓝图</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiagnosticsDialog({
  open, onOpenChange, diagnostics,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  diagnostics: ReturnType<typeof validateGraph>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dialog-wide">
        <DialogHeader>
          <DialogTitle>图谱诊断</DialogTitle>
          <DialogDescription>生成 → 校验 → 定向修复 → 再校验；每条错误提供结构化修复建议。</DialogDescription>
        </DialogHeader>
        <div className="diagnostics-list">
          {diagnostics.length ? diagnostics.map((item, index) => (
            <article key={item.code + index} className={item.severity}>
              <span>{item.severity === "error" ? <X /> : <Activity />}</span>
              <div>
                <div><Badge variant="outline">{item.code}</Badge><code>{item.subject}</code></div>
                <strong>{item.message}</strong>
                <p>可执行修复：{item.supportedFix}</p>
              </div>
            </article>
          )) : <EmptyState icon={ShieldCheck} title="图谱校验通过" copy="稳定标识、层级、关系、检查点与代码证据约束均通过。" />}
        </div>
        <DialogFooter><Button onClick={() => onOpenChange(false)}>完成</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
