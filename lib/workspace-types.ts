export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
};
export type Conversation = {
  id: string;
  nodeId: string | null;
  title: string;
  threadId?: string;
  messages: ChatMessage[];
  running?: boolean;
  turnId?: string;
  error?: string;
  pendingRequest?: {
    id: string | number;
    method: string;
    command?: string;
    reason?: string;
    questions?: {
      id: string;
      question: string;
      options?: { label: string; description: string }[];
    }[];
  };
};
export type GraphNode = {
  id: string;
  title: string;
  goal: string;
  prompt: string;
  dependencies: string[];
  tasks: {
    id: string;
    title: string;
    status: "todo" | "in_progress" | "in_review" | "done";
    evidence?: string;
  }[];
  summary: string;
};
export type Workspace = {
  version: 2;
  name: string;
  cwd: string;
  phase: "planning" | "review" | "execution";
  consensus: string;
  nodes: GraphNode[];
  conversations: Conversation[];
  error?: string;
};
