// AI 项目图谱 Codex 侧边栏注入脚本
// 在 Codex 桌面端的用户脚本环境中加载本文件，即可添加“项目图谱”入口。
(() => {
  "use strict";

  const SITE_URL = "https://ai-project-graph.jz1234da.chatgpt.site/?host=codex";
  const ENTRY_ID = "ai-project-graph-codex-entry";
  const PAGE_ID = "ai-project-graph-codex-page";

  const theme = () => {
    const root = document.documentElement;
    const explicit = root.dataset.theme || root.getAttribute("data-color-mode");
    if (explicit === "dark" || root.classList.contains("dark")) return "dark";
    if (explicit === "light" || root.classList.contains("light")) return "light";
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const postHostContext = (frame) => {
    frame.contentWindow?.postMessage({ type: "ai-project-graph:theme", theme: theme() }, "*");
    frame.contentWindow?.postMessage({
      type: "ai-project-graph:host-context",
      host: "codex",
      location: location.href,
      title: document.title,
    }, "*");
  };

  const ensureStyles = () => {
    if (document.getElementById(`${ENTRY_ID}-styles`)) return;
    const style = document.createElement("style");
    style.id = `${ENTRY_ID}-styles`;
    style.textContent = `
      #${ENTRY_ID} {
        width: calc(100% - 12px); min-height: 32px; margin: 2px 6px; display: flex;
        align-items: center; gap: 9px; border: 0; border-radius: 7px; padding: 0 10px;
        color: var(--color-token-foreground, CanvasText); background: transparent;
        font: inherit; text-align: left; cursor: pointer;
      }
      #${ENTRY_ID}:hover, #${ENTRY_ID}[aria-current="page"] {
        background: var(--color-token-list-hover-background, color-mix(in srgb, CanvasText 8%, Canvas));
      }
      #${ENTRY_ID} svg { width: 16px; height: 16px; flex: none; }
      #${PAGE_ID} { position: fixed; inset: 0; z-index: 2147483000; background: Canvas; }
      #${PAGE_ID}[hidden] { display: none; }
      #${PAGE_ID} iframe { width: 100%; height: 100%; border: 0; background: Canvas; }
    `;
    document.head.append(style);
  };

  const ensurePage = () => {
    let page = document.getElementById(PAGE_ID);
    if (page) return page;
    page = document.createElement("section");
    page.id = PAGE_ID;
    page.hidden = true;
    page.setAttribute("aria-label", "AI 项目图谱");
    const frame = document.createElement("iframe");
    frame.title = "AI 项目图谱";
    frame.src = `${SITE_URL}&theme=${theme()}`;
    frame.allow = "clipboard-read; clipboard-write";
    frame.addEventListener("load", () => postHostContext(frame));
    page.append(frame);
    document.body.append(page);
    return page;
  };

  const togglePage = () => {
    const page = ensurePage();
    const entry = document.getElementById(ENTRY_ID);
    page.hidden = !page.hidden;
    entry?.setAttribute("aria-current", page.hidden ? "false" : "page");
    if (!page.hidden) postHostContext(page.querySelector("iframe"));
  };

  const findSidebar = () => {
    const pluginText = [...document.querySelectorAll("button, a")].find((element) => /插件|plugins/i.test(element.textContent || ""));
    return pluginText?.parentElement || document.querySelector("aside nav, [data-testid*='sidebar'] nav, nav[aria-label]");
  };

  const ensureEntry = () => {
    if (document.getElementById(ENTRY_ID)) return true;
    const sidebar = findSidebar();
    if (!sidebar) return false;
    ensureStyles();
    const entry = document.createElement("button");
    entry.id = ENTRY_ID;
    entry.type = "button";
    entry.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="6" r="2" fill="currentColor"/><circle cx="19" cy="18" r="2" fill="currentColor"/><path d="M7 12h4a4 4 0 0 0 4-4V6m-4 6a4 4 0 0 1 4 4v2" fill="none" stroke="currentColor" stroke-width="1.7"/></svg><span>项目图谱</span>`;
    entry.addEventListener("click", togglePage);
    sidebar.append(entry);
    return true;
  };

  const syncTheme = () => {
    const frame = document.querySelector(`#${PAGE_ID} iframe`);
    if (frame) postHostContext(frame);
  };

  window.addEventListener("message", (event) => {
    const frame = document.querySelector(`#${PAGE_ID} iframe`);
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.data?.type === "ai-project-graph:frame-ready") postHostContext(frame);
    if (event.data?.type === "ai-project-graph:open-conversation") {
      window.dispatchEvent(new CustomEvent("ai-project-graph:open-conversation", { detail: event.data.conversation }));
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const page = document.getElementById(PAGE_ID);
      if (page && !page.hidden) togglePage();
    }
  });

  new MutationObserver(() => {
    ensureEntry();
    syncTheme();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-theme", "data-color-mode"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
  ensureEntry();
})();
