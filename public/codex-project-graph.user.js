// ==UserScript==
// @name         AI 项目图谱 for Codex
// @namespace    https://ai-project-graph.jz1234da.chatgpt.site/
// @version      0.4.0
// @description  在 Codex 侧边栏添加“项目图谱”入口
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// 也可由 CDP/用户脚本加载器直接执行；不依赖 React 私有模块或修改 Codex 安装包。
(() => {
  "use strict";

  const INJECTION_VERSION = "0.4.0";
  // The resident injector fills an about:blank iframe with this local page via
  // CDP. Loading the hosted Sites URL directly would be rejected by X-Frame-
  // Options and by the Sites sign-in gate in the Codex renderer.
  const SITE_URL = "http://127.0.0.1:5173/index.html?host=codex";
  const SENTINEL_KEY = "__aiProjectGraphCodexInjection__";
  const ENTRY_ID = "ai-project-graph-codex-entry";
  const PAGE_ID = "ai-project-graph-codex-page";
  const FRAME_ID = "ai-project-graph-codex-frame";
  const FRAME_URL_ATTRIBUTE = "data-ai-project-graph-frame-url";
  const STYLE_ID = "ai-project-graph-codex-style";
  const OWNED_ATTRIBUTE = "data-ai-project-graph-owned";
  const REATTACH_DELAY = 120;

  const previous = window[SENTINEL_KEY];
  if (previous?.version === INJECTION_VERSION && typeof previous.refresh === "function") {
    previous.refresh();
    return;
  }
  try {
    previous?.destroy?.();
  } catch (_) {
    // A previous development version may not expose destroy().
  }

  let entry = null;
  let entryLabel = null;
  let page = null;
  let frame = null;
  let observer = null;
  let refreshTimer = null;
  let active = false;
  let destroyed = false;

  const normalized = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

  const hostTheme = () => {
    const root = document.documentElement;
    const explicit = normalized(root.dataset.theme || root.getAttribute("data-color-theme") || root.getAttribute("data-color-mode"));
    if (explicit.includes("dark") || root.classList.contains("dark")) return "dark";
    if (explicit.includes("light") || root.classList.contains("light")) return "light";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  const frameUrl = () => {
    try {
      const url = new URL(SITE_URL);
      url.searchParams.set("host", "codex");
      url.searchParams.set("theme", hostTheme());
      return url.href;
    } catch (_) {
      return SITE_URL;
    }
  };

  const hostText = (chinese, english) => {
    const language = normalized(document.documentElement.lang || navigator.language);
    return language === "zh" || language.startsWith("zh-") ? chinese : english;
  };

  const postHostContext = () => {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({ type: "ai-project-graph:theme", theme: hostTheme() }, "*");
    frame.contentWindow.postMessage({
      type: "ai-project-graph:host-context",
      host: "codex",
      location: window.location.href,
      title: document.title,
    }, "*");
  };

  const installStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute(OWNED_ATTRIBUTE, "true");
    style.textContent = `
      #${ENTRY_ID}[aria-current="page"] {
        background: var(--color-token-list-hover-background, color-mix(in srgb, currentColor 8%, transparent));
        color: var(--color-token-foreground, inherit);
      }
      #${ENTRY_ID}:focus-visible {
        outline: 2px solid var(--color-token-border, Highlight);
        outline-offset: 2px;
      }
      #${PAGE_ID} {
        position: absolute;
        inset: 0;
        z-index: 20;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: Canvas;
        color: CanvasText;
        pointer-events: auto;
        -webkit-app-region: no-drag;
      }
      #${PAGE_ID}[data-fallback="true"] {
        position: fixed;
        z-index: 2147483000;
      }
      #${PAGE_ID}[hidden] { display: none !important; }
      #${FRAME_ID} {
        display: block;
        position: relative;
        z-index: 1;
        width: 100%;
        height: 100%;
        border: 0;
        background: Canvas;
        pointer-events: auto;
        -webkit-app-region: no-drag;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const sidebarRoot = () => document.querySelector(
    "[data-app-action-sidebar-scroll], aside nav[role='navigation'], aside nav, [data-testid*='sidebar'] nav, nav[aria-label]",
  );

  const isLabel = (element, labels) => labels.includes(
    normalized(element?.textContent || element?.getAttribute?.("aria-label")),
  );

  const referenceButton = (root) => {
    const buttons = [...root.querySelectorAll("button")];
    const plugin = buttons.find((button) => isLabel(button, ["插件", "plugins"]));
    if (plugin) return plugin;

    // Codex 加载插件区前的短暂窗口：退化为顶部导航组的最后一个按钮。
    const firstSection = root.querySelector("[data-app-action-sidebar-section]");
    const sectionTop = firstSection?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
    const groups = [...root.querySelectorAll("div")].filter((element) => {
      const directButtons = [...element.children].filter((child) => child.tagName === "BUTTON");
      return directButtons.length >= 3 && element.getBoundingClientRect().top < sectionTop;
    });
    const group = groups.sort((left, right) => right.children.length - left.children.length)[0];
    return [...(group?.children || [])].filter((child) => child.tagName === "BUTTON").at(-1) || null;
  };

  const cleanClonedButton = (button) => {
    button.id = ENTRY_ID;
    button.type = "button";
    button.removeAttribute("disabled");
    button.removeAttribute("aria-expanded");
    button.removeAttribute("aria-controls");
    button.removeAttribute("aria-describedby");
    button.removeAttribute("data-state");
    button.setAttribute(OWNED_ATTRIBUTE, "true");
    [...button.attributes]
      .filter((attribute) => attribute.name.startsWith("data-app-action-sidebar-"))
      .forEach((attribute) => button.removeAttribute(attribute.name));
    button.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));

    entryLabel = button.querySelector(".text-fade-truncate")
      || [...button.querySelectorAll("span")].find((node) => isLabel(node, ["插件", "plugins"]));

    const icon = button.querySelector("svg");
    if (icon) {
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "none");
      icon.setAttribute("stroke", "currentColor");
      icon.setAttribute("stroke-width", "1.8");
      icon.setAttribute("stroke-linecap", "round");
      icon.setAttribute("stroke-linejoin", "round");
      icon.innerHTML = `
        <circle cx="5" cy="12" r="2"></circle>
        <circle cx="19" cy="6" r="2"></circle>
        <circle cx="19" cy="18" r="2"></circle>
        <path d="M7 12h4a4 4 0 0 0 4-4V6m-4 6a4 4 0 0 1 4 4v2"></path>
      `;
    }
    return button;
  };

  const syncEntryText = () => {
    if (!entry) return;
    const label = hostText("项目图谱", "Project Graph");
    entry.setAttribute("aria-label", hostText("打开项目图谱", "Open Project Graph"));
    entry.setAttribute("title", label);
    if (entryLabel) entryLabel.textContent = label;
    else {
      const textNode = [...entry.querySelectorAll("span")].at(-1);
      if (textNode) textNode.textContent = label;
    }
  };

  const syncEntryState = () => {
    if (!entry) return;
    if (active) entry.setAttribute("aria-current", "page");
    else entry.removeAttribute("aria-current");
  };

  const ensureEntry = () => {
    if (destroyed || !document.body) return false;
    const root = sidebarRoot();
    if (!root) return false;
    installStyles();
    const reference = referenceButton(root);
    if (!entry) {
      const fallback = document.createElement("button");
      fallback.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="19" cy="6" r="2"></circle><circle cx="19" cy="18" r="2"></circle><path d="M7 12h4a4 4 0 0 0 4-4V6m-4 6a4 4 0 0 1 4 4v2"></path></svg><span></span>`;
      entry = cleanClonedButton(reference?.cloneNode(true) || fallback);
      entry.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePage();
      });
    }
    const parent = reference?.parentElement || root;
    if (entry.parentElement !== parent || (reference && entry.previousElementSibling !== reference)) {
      if (reference) reference.after(entry);
      else parent.append(entry);
    }
    syncEntryText();
    syncEntryState();
    return true;
  };

  const ensurePage = () => {
    if (page) return page;
    installStyles();
    page = document.createElement("section");
    page.id = PAGE_ID;
    page.hidden = true;
    page.setAttribute("aria-label", hostText("项目图谱", "Project Graph"));
    frame = document.createElement("iframe");
    frame.id = FRAME_ID;
    frame.title = hostText("AI 项目图谱", "AI Project Graph");
    frame.name = `ai-project-graph-codex-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    frame.setAttribute("data-ai-project-graph-frame", "true");
    frame.setAttribute(FRAME_URL_ATTRIBUTE, frameUrl());
    frame.referrerPolicy = "no-referrer";
    frame.allow = "clipboard-read; clipboard-write";
    frame.tabIndex = 0;
    frame.addEventListener("load", () => {
      postHostContext();
      if (active) window.requestAnimationFrame(() => frame?.focus({ preventScroll: true }));
    });
    // The injector replaces this blank document with the local application
    // HTML using Page.setDocumentContent, avoiding remote iframe policies.
    frame.src = "about:blank";
    page.append(frame);
    document.body.append(page);
    return page;
  };

  const pageMount = () => {
    const frameHost = document.querySelector(".app-shell-main-content-frame")
      || document.querySelector("[data-app-shell-main-content-layout]");
    const layout = frameHost?.closest?.("[data-app-shell-main-content-layout]");
    const surface = layout?.parentElement;
    if (!surface || !surface.closest("main")) return null;
    return surface;
  };

  const mountPage = () => {
    const currentPage = ensurePage();
    const surface = pageMount();
    if (surface) {
      currentPage.removeAttribute("data-fallback");
      if (currentPage.parentElement !== surface) surface.append(currentPage);
      return;
    }
    currentPage.setAttribute("data-fallback", "true");
    if (currentPage.parentElement !== document.body) document.body.append(currentPage);
  };

  const closePage = () => {
    active = false;
    if (page) page.hidden = true;
    document.documentElement.removeAttribute("data-ai-project-graph-open");
    syncEntryState();
  };

  const openPage = () => {
    active = true;
    mountPage();
    page.hidden = false;
    document.documentElement.setAttribute("data-ai-project-graph-open", "true");
    syncEntryState();
    postHostContext();
    window.requestAnimationFrame(() => frame?.focus({ preventScroll: true }));
  };

  const togglePage = () => {
    if (active) closePage();
    else openPage();
  };

  const onDocumentClick = (event) => {
    if (!active || !event.target?.closest?.("aside nav, [data-app-action-sidebar-scroll]")) return;
    if (event.target.closest(`#${ENTRY_ID}`)) return;
    if (event.target.closest("button, a, [role='button']")) closePage();
  };

  const scheduleRefresh = () => {
    if (destroyed || refreshTimer !== null) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      ensureEntry();
      if (active) mountPage();
      postHostContext();
    }, REATTACH_DELAY);
  };

  const refresh = () => {
    ensureEntry();
    if (active) mountPage();
    postHostContext();
  };

  const onFrameMessage = (event) => {
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.data?.type === "ai-project-graph:frame-ready") postHostContext();
    if (event.data?.type === "ai-project-graph:open-conversation") {
      window.dispatchEvent(new CustomEvent("ai-project-graph:open-conversation", {
        detail: event.data.conversation,
      }));
    }
  };

  const destroy = () => {
    destroyed = true;
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    observer?.disconnect();
    document.removeEventListener("click", onDocumentClick, true);
    window.removeEventListener("message", onFrameMessage);
    document.querySelectorAll(`[${OWNED_ATTRIBUTE}="true"]`).forEach((node) => node.remove());
    page?.remove();
    document.getElementById(STYLE_ID)?.remove();
    if (window[SENTINEL_KEY] === api) delete window[SENTINEL_KEY];
  };

  const api = { version: INJECTION_VERSION, refresh, open: openPage, close: closePage, destroy };
  window[SENTINEL_KEY] = api;
  window.addEventListener("message", onFrameMessage);
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && active) closePage();
  });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", refresh);

  const mount = () => {
    if (destroyed || observer) return;
    refresh();
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-theme", "data-color-mode", "aria-label", "aria-current"],
    });
  };

  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
})();
