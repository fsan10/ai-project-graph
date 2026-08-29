export const NODE_STATUSES = [
  "planned",
  "in_progress",
  "in_review",
  "done",
  "blocked",
] as const;

export const NODE_TYPES = [
  "system",
  "domain",
  "module",
  "feature",
  "service",
  "database",
  "queue",
  "external",
  "process",
  "data_pipeline",
  "task",
] as const;

export const EDGE_TYPES = [
  "contains",
  "depends_on",
  "blocks",
  "calls",
  "reads",
  "writes",
  "produces",
  "consumes",
  "publishes",
  "subscribes",
  "authenticates",
  "related",
] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];
export type NodeType = (typeof NODE_TYPES)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type EvidenceStatus = "none" | "planned" | "conversation" | "code" | "git" | "verified" | "invalid";
export type ConversationType = "architect" | "implementation" | "research" | "debug" | "review" | "side_chat";

export interface Blueprint {
  goal: string;
  inScope: string[];
  outOfScope: string[];
  techStack: string[];
  principles: string[];
  constraints: string[];
  majorModules: string[];
  dataStrategy: string;
  securityStrategy: string;
  deploymentStrategy: string;
  codingRules: string[];
  acceptanceDefinition: string[];
  status: "draft" | "confirmed";
}

export interface Evidence {
  id: string;
  nodeId: string;
  type: "code" | "git" | "conversation";
  repositoryUrl: string;
  revision: string;
  path: string;
  startLine?: number;
  endLine?: number;
  commitSha?: string;
  verificationStatus: "pending" | "verified" | "invalid";
  verifiedAt?: string;
}

export interface ConversationBinding {
  id: string;
  nodeId: string | null;
  type: ConversationType;
  role: "primary" | "implementation" | "research" | "debug" | "review";
  title: string;
  threadId: string;
  codexProjectId: string;
  codexProjectKind: string;
  codexHostId: string;
  workspacePath: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface Checkpoint {
  id: string;
  nodeId: string;
  graphVersion: number;
  summary: string;
  implementation: string;
  interfaces: string[];
  files: string[];
  commitSha: string;
  branch: string;
  knownLimitations: string[];
  conversationIds: string[];
  acceptedBy: string;
  acceptedAt: string;
}

export interface ArchitectureNode {
  id: string;
  stableKey: string;
  parentId: string | null;
  type: NodeType;
  name: string;
  description: string;
  goal: string;
  acceptanceCriteria: string[];
  status: NodeStatus;
  designStatus: "draft" | "confirmed";
  implementationStatus: "not_started" | "active" | "review" | "verified" | "blocked";
  evidenceStatus: EvidenceStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutMode: "auto" | "confirmed_auto" | "manual";
  layoutLocked: boolean;
  version: number;
  updatedAt: string;
}

export interface ArchitectureEdge {
  id: string;
  stableKey: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: EdgeType;
  label: string;
  layer: "execution" | "runtime" | "structure";
}

export interface ProjectState {
  project: {
    id: string;
    name: string;
    description: string;
    goal: string;
    workspacePath: string;
    repositoryUrl: string;
    defaultBranch: string;
    architectThreadId: string;
    mode: "greenfield" | "existing" | "hybrid";
    status: "active" | "archived";
  };
  blueprint: Blueprint;
  graphVersion: number;
  revision: number;
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  conversations: ConversationBinding[];
  checkpoints: Checkpoint[];
  evidence: Evidence[];
  decisions: Array<{ id: string; nodeId: string; title: string; decision: string; status: "proposed" | "accepted" }>;
  updatedAt: string;
}

export interface Diagnostic {
  code: "DUPLICATE_NODE_ID" | "INVALID_STABLE_ID" | "INVALID_PARENT" | "PARENT_CYCLE" | "UNKNOWN_EDGE_NODE" | "DEPENDENCY_CYCLE" | "NODE_OVERLAP" | "UNVERIFIED_DONE" | "UNKNOWN_SOURCE";
  severity: "error" | "warning";
  subject: string;
  message: string;
  supportedFix: string;
}

export class DomainError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);
const uid = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

function seedNode(node: Partial<ArchitectureNode> & Pick<ArchitectureNode, "id" | "name" | "type" | "x" | "y">): ArchitectureNode {
  return {
    stableKey: node.id,
    parentId: null,
    description: "",
    goal: `交付${node.name}`,
    acceptanceCriteria: [`${node.name}可用`, "具备可验证结果"],
    status: "planned",
    designStatus: "confirmed",
    implementationStatus: "not_started",
    evidenceStatus: "planned",
    width: 220,
    height: 116,
    layoutMode: "confirmed_auto",
    layoutLocked: false,
    version: 1,
    updatedAt: now(),
    ...node,
  };
}

export function createSeedState(): ProjectState {
  const checkpoint: Checkpoint = {
    id: "cp-database-v1",
    nodeId: "database",
    graphVersion: 1,
    summary: "完成用户与权限基础数据模型，作为认证模块的事实依赖。",
    implementation: "PostgreSQL schema + migration",
    interfaces: ["users", "roles", "user_roles"],
    files: ["database/schema.sql", "database/migrations/001_auth.sql"],
    commitSha: "71ab43f8d3d3f8d0fdc9c04d018e902a48d7af11",
    branch: "main",
    knownLimitations: ["暂未加入审计日志"],
    conversationIds: ["conv-db-schema"],
    acceptedBy: "User",
    acceptedAt: "2026-08-29T12:20:00.000Z",
  };

  const nodes = [
    seedNode({ id: "platform", name: "后台管理系统", type: "system", x: 70, y: 285, status: "in_progress", implementationStatus: "active" }),
    seedNode({ id: "auth", name: "身份认证", type: "domain", parentId: "platform", x: 350, y: 105, status: "in_progress", implementationStatus: "active" }),
    seedNode({ id: "auth.login", name: "账号登录", type: "feature", parentId: "auth", x: 665, y: 45, status: "in_review", implementationStatus: "review", evidenceStatus: "git", goal: "账号密码登录并签发 JWT + Refresh Token", acceptanceCriteria: ["正确密码可登录", "错误密码返回明确提示", "可刷新访问令牌", "登录状态可持久化"] }),
    seedNode({ id: "auth.token", name: "令牌刷新", type: "feature", parentId: "auth", x: 665, y: 205, status: "planned", implementationStatus: "not_started" }),
    seedNode({ id: "auth.permission", name: "权限控制", type: "feature", parentId: "auth", x: 970, y: 125, status: "blocked", implementationStatus: "blocked", goal: "基于角色限制后台功能访问" }),
    seedNode({ id: "files", name: "文件管理", type: "domain", parentId: "platform", x: 350, y: 420, status: "planned" }),
    seedNode({ id: "files.upload", name: "文件上传", type: "feature", parentId: "files", x: 665, y: 420, status: "planned" }),
    seedNode({ id: "admin", name: "管理后台", type: "module", parentId: "platform", x: 970, y: 420, status: "planned" }),
    seedNode({ id: "database", name: "用户数据库", type: "database", parentId: "platform", x: 505, y: 620, status: "done", implementationStatus: "verified", evidenceStatus: "verified", goal: "保存用户、角色与权限关系" }),
  ];

  const edges: ArchitectureEdge[] = [
    { id: "edge-platform-auth", stableKey: "platform.contains.auth", sourceNodeId: "platform", targetNodeId: "auth", type: "contains", label: "包含", layer: "structure" },
    { id: "edge-platform-files", stableKey: "platform.contains.files", sourceNodeId: "platform", targetNodeId: "files", type: "contains", label: "包含", layer: "structure" },
    { id: "edge-auth-login", stableKey: "auth.contains.login", sourceNodeId: "auth", targetNodeId: "auth.login", type: "contains", label: "包含", layer: "structure" },
    { id: "edge-auth-token", stableKey: "auth.contains.token", sourceNodeId: "auth", targetNodeId: "auth.token", type: "contains", label: "包含", layer: "structure" },
    { id: "edge-login-token", stableKey: "auth.login.blocks.token", sourceNodeId: "auth.login", targetNodeId: "auth.token", type: "blocks", label: "阻塞", layer: "execution" },
    { id: "edge-login-permission", stableKey: "auth.login.blocks.permission", sourceNodeId: "auth.login", targetNodeId: "auth.permission", type: "blocks", label: "阻塞", layer: "execution" },
    { id: "edge-database-login", stableKey: "database.reads.login", sourceNodeId: "auth.login", targetNodeId: "database", type: "reads", label: "读取用户", layer: "runtime" },
    { id: "edge-files-upload", stableKey: "files.contains.upload", sourceNodeId: "files", targetNodeId: "files.upload", type: "contains", label: "包含", layer: "structure" },
    { id: "edge-permission-admin", stableKey: "auth.permission.blocks.admin", sourceNodeId: "auth.permission", targetNodeId: "admin", type: "blocks", label: "阻塞", layer: "execution" },
  ];

  const conversations: ConversationBinding[] = [
    { id: "conv-architect", nodeId: null, type: "architect", role: "primary", title: "Project Architect · MVP 架构", threadId: "thr_architect_01", codexProjectId: "admin-console", codexProjectKind: "workspace", codexHostId: "local", workspacePath: "D:/projects/admin-console", summary: "确认 React + Node.js + PostgreSQL，认证采用 JWT + Refresh Token。", createdAt: "2026-08-29T09:00:00.000Z", updatedAt: "2026-08-29T10:10:00.000Z" },
    { id: "conv-login-impl", nodeId: "auth.login", type: "implementation", role: "implementation", title: "实现登录接口", threadId: "thr_auth_login_12", codexProjectId: "admin-console", codexProjectKind: "workspace", codexHostId: "local", workspacePath: "D:/projects/admin-console", summary: "已实现登录、刷新接口与前端状态持久化，等待用户验收。", createdAt: "2026-08-29T10:30:00.000Z", updatedAt: "2026-08-29T12:00:00.000Z" },
    { id: "conv-login-research", nodeId: "auth.login", type: "research", role: "research", title: "JWT 与 Session 方案比较", threadId: "thr_auth_research_07", codexProjectId: "admin-console", codexProjectKind: "workspace", codexHostId: "local", workspacePath: "D:/projects/admin-console", summary: "最终选择 JWT + Refresh Token，保留撤销列表扩展点。", createdAt: "2026-08-29T09:40:00.000Z", updatedAt: "2026-08-29T10:15:00.000Z" },
    { id: "conv-db-schema", nodeId: "database", type: "implementation", role: "implementation", title: "用户权限 Schema", threadId: "thr_database_03", codexProjectId: "admin-console", codexProjectKind: "workspace", codexHostId: "local", workspacePath: "D:/projects/admin-console", summary: "用户、角色、关联表已完成并通过迁移测试。", createdAt: "2026-08-28T09:00:00.000Z", updatedAt: "2026-08-28T12:00:00.000Z" },
  ];

  const evidence: Evidence[] = [
    { id: "ev-login-router", nodeId: "auth.login", type: "code", repositoryUrl: "https://github.com/example/admin-console", revision: "71ab43f8d3d3f8d0fdc9c04d018e902a48d7af11", path: "server/auth/router.ts", startLine: 31, endLine: 96, commitSha: "71ab43f8d3d3f8d0fdc9c04d018e902a48d7af11", verificationStatus: "verified", verifiedAt: "2026-08-29T12:04:00.000Z" },
    { id: "ev-database-schema", nodeId: "database", type: "code", repositoryUrl: "https://github.com/example/admin-console", revision: "71ab43f8d3d3f8d0fdc9c04d018e902a48d7af11", path: "database/schema.sql", startLine: 1, endLine: 84, commitSha: "71ab43f8d3d3f8d0fdc9c04d018e902a48d7af11", verificationStatus: "verified", verifiedAt: "2026-08-29T12:05:00.000Z" },
  ];

  return {
    project: { id: "admin-console", name: "后台管理系统", description: "面向内部运营人员的安全后台", goal: "用可追踪的架构节点组织 AI Coding 全过程", workspacePath: "D:/projects/admin-console", repositoryUrl: "https://github.com/example/admin-console", defaultBranch: "main", architectThreadId: "thr_architect_01", mode: "hybrid", status: "active" },
    blueprint: { goal: "构建可扩展、安全的后台管理系统", inScope: ["账号认证", "文件管理", "后台权限"], outOfScope: ["多租户计费", "移动端 App"], techStack: ["React", "Node.js", "PostgreSQL", "Docker"], principles: ["Plan 与 Reality 分离", "人工确认完成", "证据优先"], constraints: ["本地优先", "测试与正式环境隔离"], majorModules: ["身份认证", "文件管理", "管理后台", "用户数据库"], dataStrategy: "PostgreSQL 作为权威业务数据源", securityStrategy: "JWT + Refresh Token，角色权限最小化", deploymentStrategy: "Docker Compose 本地部署", codingRules: ["稳定 ID 不随名称变化", "所有变更必须带 revision"], acceptanceDefinition: ["核心路径自动化测试通过", "用户人工验收后才算 Done"], status: "confirmed" },
    graphVersion: 1,
    revision: 18,
    nodes,
    edges,
    conversations,
    checkpoints: [checkpoint],
    evidence,
    decisions: [{ id: "ADR-012", nodeId: "auth", title: "认证方案", decision: "JWT + Refresh Token", status: "accepted" }],
    updatedAt: now(),
  };
}

function assertRevision(state: ProjectState, expectedRevision: number) {
  if (state.revision !== expectedRevision) {
    throw new DomainError("VERSION_CONFLICT", `项目已从 revision ${expectedRevision} 更新到 ${state.revision}，请重新读取后再提交。`);
  }
}

function bump(state: ProjectState) {
  state.revision += 1;
  state.updatedAt = now();
  return state;
}

export function moveNode(state: ProjectState, nodeId: string, status: NodeStatus, expectedRevision: number, actor: "agent" | "user" = "agent") {
  assertRevision(state, expectedRevision);
  if (status === "done") {
    throw new DomainError(actor === "agent" ? "AGENT_CANNOT_COMPLETE" : "CHECKPOINT_REQUIRED", "Done 只能通过 Accept & Complete 创建 Checkpoint 后进入。");
  }
  const next = clone(state);
  const node = next.nodes.find((item) => item.id === nodeId);
  if (!node) throw new DomainError("NODE_NOT_FOUND", `节点 ${nodeId} 不存在。`);
  node.status = status;
  node.implementationStatus = status === "in_progress" ? "active" : status === "in_review" ? "review" : status === "blocked" ? "blocked" : "not_started";
  node.version += 1;
  node.updatedAt = now();
  return bump(next);
}

export function acceptNode(state: ProjectState, nodeId: string, expectedRevision: number, input: Partial<Checkpoint> = {}) {
  assertRevision(state, expectedRevision);
  const next = clone(state);
  const node = next.nodes.find((item) => item.id === nodeId);
  if (!node) throw new DomainError("NODE_NOT_FOUND", `节点 ${nodeId} 不存在。`);
  if (node.status !== "in_review") throw new DomainError("NOT_IN_REVIEW", "只有 In Review 节点可以人工验收完成。");
  const nodeEvidence = next.evidence.filter((item) => item.nodeId === node.id);
  const conversations = next.conversations.filter((item) => item.nodeId === node.id);
  const checkpoint: Checkpoint = {
    id: input.id ?? uid("cp"),
    nodeId,
    graphVersion: next.graphVersion,
    summary: input.summary ?? `${node.name}已通过用户验收。`,
    implementation: input.implementation ?? node.goal,
    interfaces: input.interfaces ?? [],
    files: input.files ?? nodeEvidence.map((item) => item.path),
    commitSha: input.commitSha ?? nodeEvidence[0]?.commitSha ?? "",
    branch: input.branch ?? next.project.defaultBranch,
    knownLimitations: input.knownLimitations ?? [],
    conversationIds: input.conversationIds ?? conversations.map((item) => item.id),
    acceptedBy: input.acceptedBy ?? "User",
    acceptedAt: input.acceptedAt ?? now(),
  };
  next.checkpoints.push(checkpoint);
  node.status = "done";
  node.implementationStatus = "verified";
  node.evidenceStatus = nodeEvidence.some((item) => item.verificationStatus === "verified") ? "verified" : "conversation";
  node.version += 1;
  node.updatedAt = now();
  return bump(next);
}

export function updateNode(state: ProjectState, nodeId: string, patch: Partial<ArchitectureNode>, expectedRevision: number) {
  assertRevision(state, expectedRevision);
  const next = clone(state);
  const node = next.nodes.find((item) => item.id === nodeId);
  if (!node) throw new DomainError("NODE_NOT_FOUND", `节点 ${nodeId} 不存在。`);
  const protectedFields: Array<keyof ArchitectureNode> = ["id", "stableKey", "version"];
  for (const key of protectedFields) delete patch[key];
  Object.assign(node, patch, { version: node.version + 1, updatedAt: now() });
  return bump(next);
}

export function updateNodeLayout(state: ProjectState, nodeId: string, x: number, y: number, expectedRevision: number) {
  return updateNode(state, nodeId, { x: Math.round(x), y: Math.round(y), layoutMode: "manual" }, expectedRevision);
}

export function createNode(state: ProjectState, input: Pick<ArchitectureNode, "id" | "name" | "type"> & Partial<ArchitectureNode>, expectedRevision: number) {
  assertRevision(state, expectedRevision);
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(input.id)) throw new DomainError("INVALID_STABLE_ID", "稳定 ID 只能由小写字母、数字和 ._- 组成，且必须以字母开头。");
  if (state.nodes.some((node) => node.id === input.id || node.stableKey === input.id)) throw new DomainError("DUPLICATE_NODE_ID", `稳定 ID ${input.id} 已存在。`);
  if (input.parentId && !state.nodes.some((node) => node.id === input.parentId)) throw new DomainError("INVALID_PARENT", `父节点 ${input.parentId} 不存在。`);
  const next = clone(state);
  next.nodes.push(seedNode({ x: 460, y: 280, ...input, id: input.id, stableKey: input.id }));
  return bump(next);
}

export function createEdge(state: ProjectState, sourceNodeId: string, targetNodeId: string, type: EdgeType, expectedRevision: number) {
  assertRevision(state, expectedRevision);
  if (sourceNodeId === targetNodeId) throw new DomainError("SELF_EDGE", "节点不能连接到自身。");
  if (![sourceNodeId, targetNodeId].every((id) => state.nodes.some((node) => node.id === id))) throw new DomainError("UNKNOWN_EDGE_NODE", "连线端点不存在。");
  if (state.edges.some((edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId && edge.type === type)) throw new DomainError("DUPLICATE_EDGE", "相同关系已存在。");
  const next = clone(state);
  next.edges.push({ id: uid("edge"), stableKey: `${sourceNodeId}.${type}.${targetNodeId}`, sourceNodeId, targetNodeId, type, label: type.replaceAll("_", " "), layer: type === "contains" ? "structure" : ["calls", "reads", "writes", "produces", "consumes", "publishes", "subscribes", "authenticates"].includes(type) ? "runtime" : "execution" });
  return bump(next);
}

export function bindConversation(state: ProjectState, nodeId: string | null, input: Partial<ConversationBinding>, expectedRevision: number) {
  assertRevision(state, expectedRevision);
  if (nodeId && !state.nodes.some((node) => node.id === nodeId)) throw new DomainError("NODE_NOT_FOUND", `节点 ${nodeId} 不存在。`);
  if (!input.threadId?.trim()) throw new DomainError("THREAD_REQUIRED", "必须保存 Codex Thread ID。");
  const next = clone(state);
  const createdAt = now();
  next.conversations.push({ id: input.id ?? uid("conv"), nodeId, type: input.type ?? "implementation", role: input.role ?? "implementation", title: input.title?.trim() || "未命名 Conversation", threadId: input.threadId.trim(), codexProjectId: input.codexProjectId?.trim() || next.project.id, codexProjectKind: input.codexProjectKind?.trim() || "workspace", codexHostId: input.codexHostId?.trim() || "local", workspacePath: input.workspacePath?.trim() || next.project.workspacePath, summary: input.summary?.trim() || "尚未生成工作摘要。", createdAt, updatedAt: createdAt });
  return bump(next);
}

export function addEvidence(state: ProjectState, nodeId: string, input: Partial<Evidence>, expectedRevision: number) {
  assertRevision(state, expectedRevision);
  const next = clone(state);
  const node = next.nodes.find((item) => item.id === nodeId);
  if (!node) throw new DomainError("NODE_NOT_FOUND", `节点 ${nodeId} 不存在。`);
  const pathValid = Boolean(input.path?.trim()) && !input.path?.startsWith("/") && !input.path?.includes("..");
  const rangeValid = (!input.startLine && !input.endLine) || (Number(input.startLine) > 0 && Number(input.endLine) >= Number(input.startLine));
  const sha = input.commitSha?.trim() ?? input.revision?.trim() ?? "";
  const revisionValid = /^[0-9a-f]{40}$/i.test(sha);
  const verificationStatus = pathValid && rangeValid && revisionValid ? "verified" : "invalid";
  next.evidence.push({ id: input.id ?? uid("ev"), nodeId, type: input.type ?? "code", repositoryUrl: input.repositoryUrl?.trim() || next.project.repositoryUrl, revision: sha, path: input.path?.trim() || "", startLine: input.startLine ? Number(input.startLine) : undefined, endLine: input.endLine ? Number(input.endLine) : undefined, commitSha: sha, verificationStatus, verifiedAt: verificationStatus === "verified" ? now() : undefined });
  node.evidenceStatus = verificationStatus === "verified" ? "verified" : "invalid";
  node.version += 1;
  node.updatedAt = now();
  return bump(next);
}

export function projectSnapshot(state: ProjectState) {
  const byStatus = Object.fromEntries(NODE_STATUSES.map((status) => [status, state.nodes.filter((node) => node.status === status).map((node) => node.id)]));
  return { projectId: state.project.id, graphVersion: state.graphVersion, revision: state.revision, completedNodes: byStatus.done, activeNodes: [...byStatus.in_progress, ...byStatus.in_review], blockedNodes: byStatus.blocked, recentDecisions: state.decisions.filter((decision) => decision.status === "accepted").slice(-5), recentCheckpoints: state.checkpoints.slice(-5), updatedAt: state.updatedAt };
}

export function compileContext(state: ProjectState, nodeId: string, currentThreadId?: string) {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node) throw new DomainError("NODE_NOT_FOUND", `节点 ${nodeId} 不存在。`);
  const parent = node.parentId ? state.nodes.find((item) => item.id === node.parentId) : undefined;
  const dependencyIds = state.edges.filter((edge) => edge.targetNodeId === nodeId && ["blocks", "depends_on"].includes(edge.type)).map((edge) => edge.sourceNodeId);
  const dependencies = dependencyIds.map((id) => {
    const dependency = state.nodes.find((item) => item.id === id)!;
    return { id: dependency.id, name: dependency.name, status: dependency.status, checkpoint: state.checkpoints.filter((checkpoint) => checkpoint.nodeId === id).at(-1) ?? null };
  });
  const currentConversation = currentThreadId ? state.conversations.find((conversation) => conversation.threadId === currentThreadId && conversation.nodeId === nodeId) ?? null : null;
  const relevantDecisions = state.decisions.filter((decision) => decision.nodeId === node.id || decision.nodeId === node.parentId);
  const evidence = state.evidence.filter((item) => item.nodeId === node.id);
  const progress = Math.round((state.nodes.filter((item) => item.status === "done").length / Math.max(1, state.nodes.length)) * 100);
  return {
    freshness: { generatedAt: now(), sourceVersion: state.revision, graphVersion: state.graphVersion, repositoryRevision: state.evidence.find((item) => item.verificationStatus === "verified")?.revision ?? null, checkpointId: state.checkpoints.filter((checkpoint) => checkpoint.nodeId === nodeId).at(-1)?.id ?? null },
    global: { projectGoal: state.project.goal, blueprintGoal: state.blueprint.goal, techStack: state.blueprint.techStack, constraints: state.blueprint.constraints, principles: state.blueprint.principles, graphVersion: state.graphVersion, revision: state.revision, overallProgress: progress },
    architecture: { node: { id: node.id, name: node.name, type: node.type }, parent: parent ? { id: parent.id, name: parent.name } : null },
    dependencies,
    node: { goal: node.goal, acceptanceCriteria: node.acceptanceCriteria, status: node.status, relevantFiles: evidence.map((item) => item.path), decisions: relevantDecisions, latestCheckpoint: state.checkpoints.filter((checkpoint) => checkpoint.nodeId === nodeId).at(-1) ?? null, conversations: state.conversations.filter((conversation) => conversation.nodeId === nodeId).map(({ id, title, type, summary, updatedAt }) => ({ id, title, type, summary, updatedAt })) },
    currentThread: currentConversation ? { threadId: currentConversation.threadId, title: currentConversation.title, summary: currentConversation.summary } : null,
  };
}

function hasCycle(nodes: string[], edges: Array<[string, string]>) {
  const graph = new Map<string, string[]>();
  for (const node of nodes) graph.set(node, []);
  for (const [from, to] of edges) graph.get(from)?.push(to);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) if (walk(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return nodes.some(walk);
}

export function validateGraph(state: ProjectState): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const node of state.nodes) {
    if (ids.has(node.id)) diagnostics.push({ code: "DUPLICATE_NODE_ID", severity: "error", subject: node.id, message: "Node ID 必须唯一。", supportedFix: "为重复节点分配新的稳定 ID。" });
    ids.add(node.id);
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(node.stableKey)) diagnostics.push({ code: "INVALID_STABLE_ID", severity: "error", subject: node.id, message: "Stable ID 格式无效。", supportedFix: "使用小写字母、数字和 ._-。" });
    if (node.parentId && !state.nodes.some((item) => item.id === node.parentId)) diagnostics.push({ code: "INVALID_PARENT", severity: "error", subject: node.id, message: `父节点 ${node.parentId} 不存在。`, supportedFix: "选择有效父节点或移除 parentId。" });
    if (node.status === "done" && !state.checkpoints.some((checkpoint) => checkpoint.nodeId === node.id)) diagnostics.push({ code: "UNVERIFIED_DONE", severity: "error", subject: node.id, message: "Done 节点缺少用户 Checkpoint。", supportedFix: "退回 In Review 后执行 Accept & Complete。" });
  }
  if (hasCycle(state.nodes.map((node) => node.id), state.nodes.filter((node) => node.parentId).map((node) => [node.id, node.parentId!]))) diagnostics.push({ code: "PARENT_CYCLE", severity: "error", subject: "graph", message: "父子层级存在循环。", supportedFix: "移除循环中的一个 parentId。" });
  for (const edge of state.edges) if (!ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId)) diagnostics.push({ code: "UNKNOWN_EDGE_NODE", severity: "error", subject: edge.id, message: "连线引用了不存在的节点。", supportedFix: "修复端点或删除该连线。" });
  const dependencyEdges = state.edges.filter((edge) => ["blocks", "depends_on"].includes(edge.type)).map((edge) => [edge.sourceNodeId, edge.targetNodeId] as [string, string]);
  if (hasCycle([...ids], dependencyEdges)) diagnostics.push({ code: "DEPENDENCY_CYCLE", severity: "warning", subject: "graph", message: "执行依赖存在循环。", supportedFix: "检查 blocks/depends_on 方向。" });
  for (let i = 0; i < state.nodes.length; i += 1) for (let j = i + 1; j < state.nodes.length; j += 1) {
    const a = state.nodes[i]; const b = state.nodes[j];
    const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    if (overlaps) diagnostics.push({ code: "NODE_OVERLAP", severity: "warning", subject: `${a.id}, ${b.id}`, message: "节点发生重叠。", supportedFix: "移动其中一个节点并保留 manual layout。" });
  }
  for (const item of state.evidence) if (item.verificationStatus === "invalid") diagnostics.push({ code: "UNKNOWN_SOURCE", severity: "warning", subject: item.path || item.id, message: "Evidence 路径、行号或 40 位 Commit SHA 无效。", supportedFix: "修正证据后重新验证。" });
  return diagnostics;
}

export function createProject(input: { name: string; goal: string; workspacePath: string; repositoryUrl: string; mode: ProjectState["project"]["mode"]; modules?: string[] }): ProjectState {
  const id = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `project-${Date.now()}`;
  const modules = (input.modules?.length ? input.modules : ["身份认证", "业务模块", "数据存储"]).map((name, index) => ({ name, id: `${id}.${name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-") || `module-${index + 1}`}` }));
  const root = seedNode({ id, name: input.name.trim(), type: "system", x: 90, y: 300, status: "in_progress", implementationStatus: "active" });
  const nodes = [root, ...modules.map((module, index) => seedNode({ id: module.id, name: module.name, type: index === modules.length - 1 ? "database" : "domain", parentId: id, x: 430 + (index % 2) * 320, y: 100 + Math.floor(index / 2) * 250 }))];
  const edges = modules.map((module) => ({ id: `edge-${module.id}`, stableKey: `${id}.contains.${module.id}`, sourceNodeId: id, targetNodeId: module.id, type: "contains" as EdgeType, label: "包含", layer: "structure" as const }));
  const timestamp = now();
  return { project: { id, name: input.name.trim(), description: "", goal: input.goal.trim(), workspacePath: input.workspacePath.trim(), repositoryUrl: input.repositoryUrl.trim(), defaultBranch: "main", architectThreadId: uid("architect"), mode: input.mode, status: "active" }, blueprint: { goal: input.goal.trim(), inScope: modules.map((module) => module.name), outOfScope: [], techStack: [], principles: ["Plan 与 Reality 分离", "人工确认完成"], constraints: ["本地优先"], majorModules: modules.map((module) => module.name), dataStrategy: "待 Project Architect 确认", securityStrategy: "待 Project Architect 确认", deploymentStrategy: "待 Project Architect 确认", codingRules: ["稳定 ID 不随名称变化"], acceptanceDefinition: ["核心验收场景通过"], status: "draft" }, graphVersion: 1, revision: 1, nodes, edges, conversations: [{ id: uid("conv"), nodeId: null, type: "architect", role: "primary", title: "Project Architect", threadId: uid("thread"), codexProjectId: id, codexProjectKind: "workspace", codexHostId: "local", workspacePath: input.workspacePath.trim(), summary: "等待确认 Project Blueprint。", createdAt: timestamp, updatedAt: timestamp }], checkpoints: [], evidence: [], decisions: [], updatedAt: timestamp };
}

export function confirmBlueprint(state: ProjectState, blueprint: Blueprint, expectedRevision: number) {
  assertRevision(state, expectedRevision);
  const next = clone(state);
  next.blueprint = { ...clone(blueprint), status: "confirmed" };
  next.graphVersion += 1;
  return bump(next);
}
