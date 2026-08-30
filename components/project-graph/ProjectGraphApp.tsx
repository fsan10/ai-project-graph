"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowRight, Bot, Box, Braces, Check, CheckCircle2,
  ChevronDown, CircleDot, Code2, Database, FileCode2, GitCommitHorizontal,
  GitFork, Layers3, Link2, LockKeyhole, Maximize2, MessageSquarePlus, MousePointer2,
  Network, PanelLeftClose, Plus, Search, ShieldCheck, Sparkles, Upload, Waypoints,
  X, ZoomIn, ZoomOut,
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import {
  EDGE_TYPES, NODE_STATUSES, NODE_TYPES, acceptNode, addEvidence, bindConversation,
  compileContext, confirmBlueprint, createEdge, createNode, createProject, createSeedState,
  moveNode, projectSnapshot, updateNode, updateNodeLayout, validateGraph,
  type ArchitectureEdge, type ArchitectureNode, type Blueprint, type ConversationBinding,
  type EdgeType, type NodeStatus, type NodeType, type ProjectState,
} from "@/lib/domain";

const STORAGE_KEY = "ai-project-graph:v1";

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
  greenfield: "新建项目（Greenfield）", existing: "现有仓库（Existing）", hybrid: "计划与现实并行（Hybrid）",
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

function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function normalizeState(value: unknown): ProjectState {
  if (!value || typeof value !== "object") throw new Error("文件不是有效的 AI Project Graph 项目快照。");
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
  return edge.layer === "runtime" ? "#22c9b6" : edge.layer === "execution" ? "#f2aa3d" : "#617089";
}

export function ProjectGraphApp() {
  const [state, setState] = useState<ProjectState>(() => createSeedState());
  const [hydrated, setHydrated] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("auth.login");
  const [lens, setLens] = useState<Lens>("architecture");
  const [search, setSearch] = useState("");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [view, setView] = useState({ x: 24, y: 28, zoom: 0.78 });
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [connectType, setConnectType] = useState<EdgeType>("depends_on");
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dialogs, setDialogs] = useState({
    project: false, node: false, conversation: false, evidence: false,
    blueprint: false, diagnostics: false,
  });
  const [blueprintDraft, setBlueprintDraft] = useState<Blueprint>(() => createSeedState().blueprint);
  const importRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string; pointerX: number; pointerY: number; originX: number; originY: number;
    currentX: number; currentY: number;
  } | null>(null);
  const panRef = useRef<{
    pointerX: number; pointerY: number; originX: number; originY: number;
  } | null>(null);

  const setDialog = (name: keyof typeof dialogs, value: boolean) => {
    setDialogs((current) => ({ ...current, [name]: value }));
  };

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const restored = normalizeState(JSON.parse(saved));
          setState(restored);
          setSelectedNodeId(restored.nodes[0]?.id ?? "");
          setBlueprintDraft(restored.blueprint);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        toast.warning("本地数据损坏，已加载安全示例项目。");
      } finally {
        setHydrated(true);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragRef.current) {
        const nextX = dragRef.current.originX + (event.clientX - dragRef.current.pointerX) / view.zoom;
        const nextY = dragRef.current.originY + (event.clientY - dragRef.current.pointerY) / view.zoom;
        dragRef.current.currentX = nextX;
        dragRef.current.currentY = nextY;
        setDragPreview({ id: dragRef.current.id, x: nextX, y: nextY });
      }
      if (panRef.current) {
        setView((current) => ({
          ...current,
          x: panRef.current!.originX + event.clientX - panRef.current!.pointerX,
          y: panRef.current!.originY + event.clientY - panRef.current!.pointerY,
        }));
      }
    };
    const up = () => {
      if (dragRef.current) {
        const { id, currentX, currentY } = dragRef.current;
        setState((current) => updateNodeLayout(current, id, currentX, currentY, current.revision));
      }
      dragRef.current = null;
      panRef.current = null;
      setDragPreview(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [view.zoom]);

  const selectedNode = state.nodes.find((node) => node.id === selectedNodeId) ?? state.nodes[0] ?? null;
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
      setState(next);
      setSelectedNodeId(next.nodes[0]?.id ?? "");
      setBlueprintDraft(next.blueprint);
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
    try {
      await navigator.clipboard.writeText(conversation.threadId);
      toast.success("已请求 Codex Bridge 打开，并复制 Thread ID");
    } catch {
      toast.info("Thread: " + conversation.threadId);
    }
  };

  return (
    <main className="app-shell">
      <Toaster position="top-center" richColors />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Network size={18} /></div>
          <div><strong>AI Project Graph</strong><span>以架构为中心的 AI Coding 工作台</span></div>
        </div>
        <div className="project-crumb">
          <span className="status-light" />
          <div><strong>{state.project.name}</strong><span>{projectModeLabels[state.project.mode]} · 第 {state.graphVersion} 版</span></div>
          <ChevronDown size={14} />
        </div>
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
          }}><Sparkles />项目蓝图（Blueprint）</Button>
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
                <DialogTitle>创建 AI Project Graph</DialogTitle>
                <DialogDescription>创建 Project Architect、Blueprint Draft 和第一版稳定 ID 架构。</DialogDescription>
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
                setState(next);
                setSelectedNodeId(next.nodes[0].id);
                setBlueprintDraft(next.blueprint);
                setDialog("project", false);
                setDialog("blueprint", true);
                toast.success("项目架构师（Project Architect）与 Blueprint Draft 已创建");
              }}>
                <FormField label="项目名称"><Input name="name" placeholder="例如：电商经营分析平台" autoFocus /></FormField>
                <FormField label="初始化模式">
                  <select name="mode" className="native-select">
                    <option value="greenfield">新建项目（Greenfield）</option>
                    <option value="existing">现有仓库（Existing）</option>
                    <option value="hybrid">计划与现实并行（Hybrid）</option>
                  </select>
                </FormField>
                <FormField label="项目目标"><Textarea name="goal" placeholder="用一句话说明要构建什么，以及服务谁" /></FormField>
                <FormField label="主要模块" hint="用逗号或换行分隔，系统会为每个模块创建稳定 ID">
                  <Textarea name="modules" placeholder="身份认证，文件管理，数据处理，经营看板" />
                </FormField>
                <FormField label="工作区路径（Workspace）"><Input name="workspacePath" placeholder="D:/projects/commerce-platform" /></FormField>
                <FormField label="代码仓库地址（Repository URL）"><Input name="repositoryUrl" placeholder="https://github.com/org/repo" /></FormField>
              </form>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog("project", false)}>取消</Button>
                <Button type="submit" form="new-project-form">创建并进入 Blueprint</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="rail-section">
            <span className="rail-label">总览</span>
            <button className="rail-item active"><Network /><span>架构</span><em>{state.nodes.length}</em></button>
            <button className="rail-item" onClick={() => setLens("progress")}><Activity /><span>项目状态（Project State）</span><em>{progress}%</em></button>
            <button className="rail-item" onClick={() => setDialog("blueprint", true)}><FileCode2 /><span>项目蓝图（Blueprint）</span><em>第 {state.graphVersion} 版</em></button>
          </div>

          <div className="rail-section conversations-list">
            <span className="rail-label">会话</span>
            <button
              className="rail-item architect"
              onClick={() => void openConversation(state.conversations.find((item) => item.type === "architect"))}
            ><Bot /><span>项目架构师（Project Architect）</span><i /></button>
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
            <div><span>项目状态（Project State）</span><strong>{progress}%</strong></div>
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
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索节点、API、文件或会话" />
              <kbd>⌘K</kbd>
            </div>
            <div className="toolbar-divider" />
            <Dialog open={dialogs.node} onOpenChange={(value) => setDialog("node", value)}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Plus />节点</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>添加架构节点（Architecture Node）</DialogTitle>
                  <DialogDescription>稳定 ID 创建后不可变；名称和位置可以持续调整。</DialogDescription>
                </DialogHeader>
                <form id="new-node-form" className="form-grid" onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const id = String(data.get("id") ?? "").trim();
                  const name = String(data.get("name") ?? "").trim();
                  if (!id || !name) return toast.error("稳定 ID 和名称不能为空");
                  const ok = run(() => createNode(state, {
                    id,
                    name,
                    type: String(data.get("type")) as NodeType,
                    parentId: String(data.get("parentId") || "") || null,
                    goal: String(data.get("goal") || "交付" + name),
                  }, state.revision), "节点已创建");
                  if (ok) {
                    setSelectedNodeId(id);
                    setDialog("node", false);
                  }
                }}>
                  <FormField label="Stable ID" hint="示例：auth.password-reset"><Input name="id" placeholder="domain.feature" autoFocus /></FormField>
                  <FormField label="节点名称"><Input name="name" placeholder="密码重置" /></FormField>
                  <FormField label="类型">
                    <select name="type" className="native-select">
                      {NODE_TYPES.map((type) => <option key={type} value={type}>{nodeTypeLabels[type]}</option>)}
                    </select>
                  </FormField>
                  <FormField label="父节点">
                    <select name="parentId" className="native-select">
                      <option value="">无</option>
                      {state.nodes.map((node) => <option value={node.id} key={node.id}>{node.name} · {node.id}</option>)}
                    </select>
                  </FormField>
                  <FormField label="目标（Goal）"><Textarea name="goal" placeholder="该节点最终需要交付什么" /></FormField>
                </form>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialog("node", false)}>取消</Button>
                  <Button form="new-node-form" type="submit">创建节点</Button>
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

          <div
            className={cx("graph-canvas", connectMode && "connecting")}
            ref={canvasRef}
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest(".canvas-grid")) return;
              panRef.current = {
                pointerX: event.clientX, pointerY: event.clientY, originX: view.x, originY: view.y,
              };
            }}
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
              <svg className="edge-layer" width="1450" height="900" aria-hidden="true">
                <defs>
                  <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,6 L9,3 z" fill="context-stroke" />
                  </marker>
                </defs>
                {state.edges.filter((edge) => edgeVisible(edge, lens)).map((edge) => {
                  const source = state.nodes.find((node) => node.id === edge.sourceNodeId);
                  const target = state.nodes.find((node) => node.id === edge.targetNodeId);
                  if (!source || !target) return null;
                  const sourcePos = dragPreview?.id === source.id ? dragPreview : source;
                  const targetPos = dragPreview?.id === target.id ? dragPreview : target;
                  const x1 = sourcePos.x + source.width;
                  const y1 = sourcePos.y + source.height / 2;
                  const x2 = targetPos.x;
                  const y2 = targetPos.y + target.height / 2;
                  const midX = x1 + (x2 - x1) / 2;
                  const path = Math.abs(x2 - x1) < 50
                    ? "M " + x1 + " " + y1 + " C " + (x1 + 90) + " " + y1 + ", " + (x2 - 90) + " " + y2 + ", " + x2 + " " + y2
                    : "M " + x1 + " " + y1 + " C " + midX + " " + y1 + ", " + midX + " " + y2 + ", " + x2 + " " + y2;
                  return (
                    <g key={edge.id} className="edge-group">
                      <path d={path} stroke={edgeColor(edge)} markerEnd="url(#arrow)" />
                      <text x={midX} y={(y1 + y2) / 2 - 7}>{edgeTypeLabels[edge.type] ?? edge.label}</text>
                    </g>
                  );
                })}
              </svg>
              {state.nodes.map((node) => (
                <GraphNode
                  key={node.id}
                  node={node}
                  selected={selectedNode?.id === node.id}
                  matched={matches.has(node.id)}
                  connecting={connectSource === node.id}
                  position={dragPreview?.id === node.id ? dragPreview : node}
                  evidenceCount={state.evidence.filter((item) =>
                    item.nodeId === node.id && item.verificationStatus === "verified",
                  ).length}
                  onClick={() => chooseNode(node.id)}
                  onPointerDown={(event) => {
                    if (connectMode || node.layoutLocked) return;
                    event.stopPropagation();
                    dragRef.current = {
                      id: node.id, pointerX: event.clientX, pointerY: event.clientY,
                      originX: node.x, originY: node.y, currentX: node.x, currentY: node.y,
                    };
                  }}
                />
              ))}
            </div>
            <div className="canvas-hint"><MousePointer2 size={13} />拖动画布 · 滚轮缩放 · 节点位置自动保存</div>
          </div>

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
          onNewConversation={() => setDialog("conversation", true)}
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
              "已创建 Checkpoint，已更新 Project State",
            );
          }}
        />
      </section>

      <ConversationDialog
        open={dialogs.conversation}
        onOpenChange={(value) => setDialog("conversation", value)}
        state={state}
        node={selectedNode}
        onCreate={(input) => {
          if (!selectedNode) return;
          const ok = run(
            () => bindConversation(state, selectedNode.id, input, state.revision),
            "Conversation 已绑定到节点",
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
            "Evidence 已校验并绑定",
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
            "Blueprint 已确认，架构第 " + (state.graphVersion + 1) + " 版",
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
  node, selected, matched, connecting, position, evidenceCount, onClick, onPointerDown,
}: {
  node: ArchitectureNode;
  selected: boolean;
  matched: boolean;
  connecting: boolean;
  position: { x: number; y: number };
  evidenceCount: number;
  onClick: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const Icon = nodeIcons[node.type];
  return (
    <button
      className={cx(
        "graph-node", statusMeta[node.status].className, selected && "selected",
        !matched && "dimmed", connecting && "connect-source",
      )}
      style={{ left: position.x, top: position.y, width: node.width, height: node.height }}
      onClick={onClick}
      onPointerDown={onPointerDown}
    >
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
    </button>
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
              )) : <EmptyState icon={GitFork} title="没有直接依赖" copy="使用连接模式添加 blocks 或 depends_on。" />}
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
                    <small>{item.startLine ? "第 " + item.startLine + "–" + item.endLine + " 行" : "未指定行范围"} · {item.commitSha?.slice(0, 8) || "无 Commit"}</small>
                  </span>
                  {item.verificationStatus === "verified" ? <ShieldCheck /> : <X />}
                </div>
              ))}
              {!evidence.length ? <EmptyState icon={FileCode2} title="尚无代码证据" copy="绑定 path、line 与 40 位 Commit SHA。" /> : null}
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
                    系统将创建 Completion Checkpoint，记录实现、证据、会话、分支和人工验收时间，并更新 Project State。
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
            <div><Code2 /><span><strong>Context Compiler</strong><small>全局 + 依赖 + 节点 + 当前会话</small></span></div>
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
              {!checkpoints.length ? <EmptyState icon={GitCommitHorizontal} title="尚无 Checkpoint" copy="人工验收完成后自动生成。" /> : null}
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
  open, onOpenChange, state, node, onCreate,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  state: ProjectState;
  node: ArchitectureNode | null;
  onCreate: (input: Partial<ConversationBinding>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建节点会话</DialogTitle>
          <DialogDescription>保存完整 Codex Binding；新会话只编译当前节点相关上下文。</DialogDescription>
        </DialogHeader>
        <form id="conversation-form" className="form-grid" onSubmit={(event) => {
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
            <select className="native-select" name="type">
              <option value="implementation">实现</option><option value="research">研究</option>
              <option value="debug">调试</option><option value="review">评审</option><option value="side_chat">侧聊</option>
            </select>
          </FormField>
          <FormField label="Codex Thread ID"><Input name="threadId" placeholder="thr_..." required /></FormField>
          <FormField label="Codex Project ID"><Input name="codexProjectId" defaultValue={state.project.id} /></FormField>
          <FormField label="Codex Host ID"><Input name="codexHostId" defaultValue="local" /></FormField>
          <FormField label="工作区（Workspace）"><Input name="workspacePath" defaultValue={state.project.workspacePath} /></FormField>
          <FormField label="当前摘要"><Textarea name="summary" placeholder="可稍后由 Agent 更新" /></FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="submit" form="conversation-form">绑定并编译 Context</Button>
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
          <DialogTitle>绑定代码仓库证据（Repository Evidence）</DialogTitle>
          <DialogDescription>Fail-closed：路径、行号或 40 位 Commit SHA 无效时不会显示“已验证”。</DialogDescription>
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
          <FormField label="代码仓库地址（Repository URL）"><Input name="repositoryUrl" defaultValue={state.project.repositoryUrl} /></FormField>
          <FormField label="相对路径"><Input name="path" placeholder="server/auth/router.ts" required /></FormField>
          <div className="two-columns">
            <FormField label="起始行号"><Input name="startLine" type="number" min="1" defaultValue="1" /></FormField>
            <FormField label="结束行号"><Input name="endLine" type="number" min="1" defaultValue="1" /></FormField>
          </div>
          <FormField label="40 位 Commit SHA">
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
          <DialogTitle>项目蓝图（Project Blueprint）</DialogTitle>
          <DialogDescription>用户确认的结构化项目合同，不是聊天摘要。确认后生成新的图版本（Graph Version）。</DialogDescription>
        </DialogHeader>
        <div className="blueprint-status">
          <Badge className={draft.status === "confirmed" ? "done-badge" : "status-review"}>{blueprintStatusLabels[draft.status]}</Badge>
          <span>Project Architect · {state.project.architectThreadId}</span>
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
          <Button onClick={onConfirm}><Check />确认 Blueprint</Button>
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
          <DialogTitle>图谱诊断（Graph Diagnostics）</DialogTitle>
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
          )) : <EmptyState icon={ShieldCheck} title="图谱校验通过" copy="稳定 ID、层级、关系、Checkpoint 与 Evidence 约束均通过。" />}
        </div>
        <DialogFooter><Button onClick={() => onOpenChange(false)}>完成</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
