import { createRoot } from "react-dom/client";

import "./app/globals.css";
import { NativeGraphApp } from "./components/project-graph/NativeGraphApp";

const root = document.getElementById("root");

if (!root) {
  throw new Error("AI 项目图谱嵌入页面缺少 root 容器。");
}

createRoot(root).render(<NativeGraphApp />);
