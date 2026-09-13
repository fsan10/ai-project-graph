"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  GitBranch,
  MessageSquare,
  Plus,
  Square,
  Workflow,
} from "lucide-react";
import type { Workspace } from "../../lib/workspace-types";
import { ArchitectureCanvas } from "./ArchitectureCanvas";
import "./workspace.css";

declare global {
  interface Window {
    __GRAPH_TOKEN__?: string;
  }
}
const statusLabels = {
  todo: "待开始",
  in_progress: "进行中",
  in_review: "待验收",
  done: "已完成",
};
export function PlanningWorkspace() {
  const [state, setState] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("main");
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [view, setView] = useState<"chat" | "graph">("chat");
  const bottom = useRef<HTMLDivElement>(null);
  async function api(payload?: Record<string, unknown>) {
    const base = new URL("/api/workspace", document.baseURI);
    const response = await fetch(base, {
      method: payload ? "POST" : "GET",
      headers: {
        "x-graph-token": window.__GRAPH_TOKEN__ || "",
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "无法连接本地 Codex 服务");
    return data as Workspace;
  }
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api();
        if (active) setState(next);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) timer = setTimeout(poll, 900);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const conversation = state?.conversations.find((c) => c.id === selected);
  const node = state?.nodes.find((n) => n.id === nodeId);
  const latestText = conversation?.messages.at(-1)?.text;
  useEffect(() => {
    if (latestText) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected, latestText]);
  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const next = await api(payload);
      setState(next);
      return next;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!draft.trim() || busy || conversation?.running) return;
    const next = await act({
      action: "send",
      conversationId: selected,
      text: draft,
    });
    if (next) setDraft("");
  }
  async function newConversation(id: string) {
    const next = await act({ action: "conversation", nodeId: id });
    if (next) {
      setSelected(next.conversations.at(-1)!.id);
      setNodeId(id);
      setView("chat");
    }
  }
  function chooseNode(id: string) {
    setNodeId(id);
    setView("chat");
    const existing = state?.conversations.filter((c) => c.nodeId === id).at(-1);
    if (existing) {
      setSelected(existing.id);
      setView("chat");
    } else setSelected("");
  }
  const tasks =
    state?.nodes.flatMap((n) =>
      n.tasks.map((t) => ({ ...t, nodeTitle: n.title, nodeId: n.id })),
    ) || [];
  return (
    <div className="pw">
      <header className="pw-header">
        <div className="pw-brand">
          <Workflow size={21} />
          <strong>项目图谱</strong>
          <span>/</span>
          <span>{state?.name || "连接工作台"}</span>
        </div>
        <div className="pw-phase">
          <i />
          {state?.phase === "execution"
            ? "按架构执行"
            : state?.phase === "review"
              ? "等待确认架构"
              : "规划中"}
        </div>
      </header>
      <div className="pw-layout">
        <nav className="pw-nav" aria-label="项目对话">
          <small>工作空间</small>
          <button
            className={!nodeId ? "active" : ""}
            onClick={() => {
              setSelected("main");
              setNodeId(null);
              setView("chat");
            }}
          >
            <MessageSquare size={16} />
            项目主对话
          </button>
          <button
            className={view === "graph" ? "active" : ""}
            onClick={() => setView("graph")}
          >
            <GitBranch size={16} />
            架构图<span>{state?.nodes.length || 0}</span>
          </button>
          <div className="pw-nav-title">
            <small>架构节点</small>
            <span>{state?.nodes.length || 0}</span>
          </div>
          {!state?.nodes.length && (
            <p className="pw-muted">
              先聊清楚想法。
              <br />
              确认方向后，节点会出现在这里。
            </p>
          )}
          {state?.nodes.map((n) => (
            <div key={n.id}>
              <button
                className={nodeId === n.id ? "active" : ""}
                onClick={() => chooseNode(n.id)}
              >
                <ChevronRight size={14} />
                {n.title}
                <span>
                  {n.tasks.filter((t) => t.status === "done").length}/
                  {n.tasks.length}
                </span>
              </button>
              {nodeId === n.id && (
                <div className="pw-sessions">
                  {state.conversations
                    .filter((c) => c.nodeId === n.id)
                    .map((c) => (
                      <button
                        className={selected === c.id ? "active" : ""}
                        key={c.id}
                        onClick={() => {
                          setSelected(c.id);
                          setView("chat");
                        }}
                      >
                        {c.running ? "◌" : "↳"} {c.title}
                      </button>
                    ))}
                  <button
                    disabled={busy || state.phase !== "execution"}
                    onClick={() => void newConversation(n.id)}
                  >
                    <Plus size={13} />
                    开启新对话
                  </button>
                </div>
              )}
            </div>
          ))}
          <div className="pw-nav-footer">
            <i />
            本地保存 · Codex 引擎
            <br />
            <span>新对话继承节点交接，不复制整段历史</span>
          </div>
        </nav>
        <main className="pw-main">
          <div className="pw-toolbar">
            <div>
              <strong>
                {view === "graph" ? "项目架构" : node?.title || "项目主对话"}
              </strong>
              <span>
                {view === "graph"
                  ? "目标、依赖与任务的共同地图"
                  : node
                    ? "围绕一个目标，保持上下文清晰"
                    : "从一个想法，走到共同确认的方案"}
              </span>
            </div>
            {state?.phase !== "execution" && (
              <button
                disabled={
                  busy ||
                  state?.conversations[0].running ||
                  !state?.conversations[0].messages.some(
                    (m) => m.role === "assistant",
                  )
                }
                onClick={async () => {
                  setSelected("main");
                  setNodeId(null);
                  setView("chat");
                  await act({ action: "blueprint" });
                }}
              >
                生成架构草案 <ChevronRight size={14} />
              </button>
            )}
          </div>
          {(error || state?.error || conversation?.error) && (
            <div className="pw-error" role="alert">
              {error || state?.error || conversation?.error}
            </div>
          )}
          {conversation?.pendingRequest && (
            <div className="pw-interaction">
              <strong>Codex 需要你的回应</strong>
              <p>
                {conversation.pendingRequest.reason ||
                  conversation.pendingRequest.command ||
                  "请确认下方请求后继续"}
              </p>
              {conversation.pendingRequest.questions?.map((q) => (
                <label key={q.id}>
                  {q.question}
                  <input
                    value={answers[q.id] || ""}
                    onChange={(e) =>
                      setAnswers({ ...answers, [q.id]: e.target.value })
                    }
                  />
                  {q.options?.map((o) => (
                    <button
                      key={o.label}
                      onClick={() =>
                        setAnswers({ ...answers, [q.id]: o.label })
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </label>
              ))}
              <button
                disabled={busy}
                onClick={() =>
                  void act({
                    action: "respond",
                    conversationId: selected,
                    requestId: conversation.pendingRequest!.id,
                    decision: "accept",
                    answers,
                  })
                }
              >
                {conversation.pendingRequest.questions
                  ? "提交回答"
                  : "允许这一次"}
              </button>
              {!conversation.pendingRequest.questions && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act({
                      action: "respond",
                      conversationId: selected,
                      requestId: conversation.pendingRequest!.id,
                      decision: "decline",
                    })
                  }
                >
                  拒绝
                </button>
              )}
            </div>
          )}
          {state?.phase === "review" && (
            <div className="pw-review">
              <span>
                架构草案已生成。查看节点目标、依赖和任务，继续沟通或确认执行。
              </span>
              <button onClick={() => setView("graph")}>查看架构</button>
              <button
                className="pw-primary"
                disabled={busy || state.conversations.some((c) => c.running)}
                onClick={() => void act({ action: "confirm" })}
              >
                <Check size={14} />
                确认框架
              </button>
            </div>
          )}
          {view === "graph" ? (
            <div className="pw-graph">
              {!state?.nodes.length ? (
                <div className="pw-empty">
                  <GitBranch size={32} />
                  <h2>架构，从共识中生长</h2>
                  <p>这里暂时是空白。先在主对话中聊聊你想做什么。</p>
                  <button
                    onClick={() => {
                      setView("chat");
                      setSelected("main");
                      setNodeId(null);
                    }}
                  >
                    回到主对话
                  </button>
                </div>
              ) : (
                <>
                  <div className="pw-consensus">
                    <small>项目共识</small>
                    <h2>{state.name}</h2>
                    <p>{state.consensus}</p>
                  </div>
                  <ArchitectureCanvas
                    nodes={state.nodes}
                    onSelect={(id) => {
                      chooseNode(id);
                      setView("chat");
                    }}
                  />
                </>
              )}
            </div>
          ) : (
            <>
              <div className="pw-messages">
                {node && (
                  <div className="pw-context">
                    <small>节点总目标</small>
                    <p>{node.goal}</p>
                    <details>
                      <summary>职责提示词与交接</summary>
                      <p>{node.prompt}</p>
                      <p>
                        {node.summary ||
                          "尚无交接摘要。完成阶段工作后，可生成摘要供新对话复用。"}
                      </p>
                    </details>
                  </div>
                )}
                {!conversation?.messages.length && (
                  <div className="pw-empty">
                    <div className="pw-mark">
                      <Workflow size={28} />
                    </div>
                    <small>
                      {node ? "一个目标，多段清晰的对话" : "先有想法，再有架构"}
                    </small>
                    <h1>
                      {node
                        ? `一起完成「${node.title}」`
                        : "你想做一个怎样的项目？"}
                    </h1>
                    <p>
                      {node
                        ? "新对话会自动获取项目共识、节点职责和已保存的交接摘要。"
                        : "聊聊你的想法、要解决的问题，或还没想清楚的部分。\n我们先把方向聊透，再一起拆解架构与任务。"}
                    </p>
                    {!node && (
                      <div className="pw-suggestions">
                        {[
                          "我有一个产品想法，帮我梳理一下",
                          "我想解决现有工作中的一个问题",
                          "我有需求，但还没确定技术方案",
                        ].map((t) => (
                          <button key={t} onClick={() => setDraft(t)}>
                            {t}
                            <ChevronRight size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                    {!node &&
                      state &&
                      !state.conversations.some((c) => c.threadId) && (
                        <label className="pw-directory">
                          项目工作目录
                          <input
                            aria-label="项目工作目录"
                            defaultValue={state.cwd}
                            onBlur={(e) => {
                              if (e.target.value !== state.cwd)
                                void act({
                                  action: "cwd",
                                  cwd: e.target.value,
                                });
                            }}
                          />
                        </label>
                      )}
                    {node && !conversation && (
                      <button
                        disabled={busy || state?.phase !== "execution"}
                        onClick={() => void newConversation(node.id)}
                      >
                        <Plus size={16} />
                        开始节点对话
                      </button>
                    )}
                  </div>
                )}
                {conversation?.messages.map((m) => (
                  <div className={`pw-message ${m.role}`} key={m.id}>
                    <small>
                      {m.role === "user"
                        ? "你"
                        : m.role === "tool"
                          ? "执行记录"
                          : "Codex"}
                    </small>
                    <div>
                      {conversation.running &&
                      m.role === "assistant" &&
                      m.text.trimStart().startsWith("{")
                        ? "正在整理结构化结果…"
                        : m.text}
                    </div>
                  </div>
                ))}
                {conversation?.running && (
                  <div className="pw-thinking">◌ Codex 正在处理…</div>
                )}
                <div ref={bottom} />
              </div>
              <div className="pw-compose-area">
                {node && conversation && (
                  <button
                    className="pw-handoff"
                    disabled={
                      busy ||
                      conversation.running ||
                      !conversation.messages.length
                    }
                    onClick={() =>
                      void act({ action: "handoff", conversationId: selected })
                    }
                  >
                    生成交接摘要，供下一段对话复用
                  </button>
                )}
                <form
                  className="pw-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    aria-label="发送给 Codex"
                    placeholder={
                      node
                        ? "讨论或执行这个节点的任务…"
                        : "告诉我你的想法，我们一起把它变清晰…"
                    }
                    value={draft}
                    disabled={!state || !conversation}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div>
                    <span>
                      {node ? "节点上下文" : "规划对话 · 只讨论，不修改代码"}
                    </span>
                    {conversation?.running ? (
                      <button
                        type="button"
                        aria-label="停止生成"
                        onClick={() =>
                          void act({ action: "stop", conversationId: selected })
                        }
                      >
                        <Square size={15} />
                      </button>
                    ) : (
                      <button
                        className="pw-send"
                        aria-label="发送消息"
                        disabled={busy || !draft.trim() || !conversation}
                      >
                        <ArrowUp size={19} />
                      </button>
                    )}
                  </div>
                </form>
                <p>Enter 发送 · Shift + Enter 换行 · 对话自动归属当前节点</p>
              </div>
            </>
          )}
        </main>
        <aside className="pw-board">
          <div className="pw-board-heading">
            <strong>任务看板</strong>
            <span>
              {tasks.filter((t) => t.status === "done").length}/{tasks.length}
            </span>
          </div>
          <div className="pw-progress">
            <div
              style={{
                width: `${tasks.length ? (tasks.filter((t) => t.status === "done").length / tasks.length) * 100 : 0}%`,
              }}
            />
          </div>
          {!tasks.length ? (
            <div className="pw-board-empty">
              <Square size={22} />
              <h3>还没有任务</h3>
              <p>
                确认项目框架后，
                <br />
                在这里跟踪每一步进展。
              </p>
              <ol>
                <li>沟通项目想法</li>
                <li>审阅并确认架构</li>
                <li>按节点推进任务</li>
              </ol>
            </div>
          ) : (
            Object.entries(statusLabels).map(([status, label]) => (
              <section key={status}>
                <h4>
                  <i className={status} />
                  {label}
                  <span>{tasks.filter((t) => t.status === status).length}</span>
                </h4>
                {tasks
                  .filter((t) => t.status === status)
                  .map((t) => (
                    <article key={t.id}>
                      <button
                        className="pw-task-title"
                        onClick={() => {
                          chooseNode(t.nodeId);
                          setView("chat");
                        }}
                      >
                        {t.title}
                      </button>
                      <small>{t.nodeTitle}</small>
                      {t.evidence && (
                        <details>
                          <summary>验证证据</summary>
                          <p>{t.evidence}</p>
                        </details>
                      )}
                      <select
                        aria-label={`${t.title}状态`}
                        value={t.status}
                        disabled={busy || state?.phase !== "execution"}
                        onChange={(e) =>
                          void act({
                            action: "task",
                            taskId: t.id,
                            status: e.target.value,
                          })
                        }
                      >
                        {Object.entries(statusLabels).map(([s, l]) => (
                          <option value={s} key={s}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </article>
                  ))}
              </section>
            ))
          )}
          <p className="pw-board-note">
            执行记录保留在节点对话中。进度由 Codex 同步，完成由你验收。
          </p>
        </aside>
      </div>
    </div>
  );
}
