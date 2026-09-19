export type NativeProject = {
  id: string;
  name: string;
  path: string;
  roots: string[];
  canonicalId: string;
};
export type NativeThread = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  status: string;
  snippet?: string;
};
export type NativeNode = {
  id: string;
  title: string;
  goal: string;
  prompt: string;
  summary: string;
  status: "todo" | "ready" | "in_progress" | "in_review" | "done";
  completedAt: string | null;
  rootThreadId: string | null;
  memory: {
    status: "draft" | "aligning" | "ready" | "stale";
    summary: string;
    acceptance: string;
    decisions: string[];
    constraints: string[];
    version: number;
    updatedAt: string | null;
  };
  conversations: {
    threadId: string;
    kind: "memory" | "branch" | "imported";
    parentThreadId: string | null;
    createdAt: string | null;
  }[];
  x: number;
  y: number;
  threadIds: string[];
  tasks: { id: string; title: string; status: string; evidence?: string }[];
};
export type NativeGraph = {
  version: 4;
  projectId: string;
  name: string;
  revision: number;
  nodes: NativeNode[];
  edges: { id: string; source: string; target: string; label: string }[];
  document: string | null;
  confirmedAt: string | null;
  updatedAt: string;
  planningThreadId?: string;
};
