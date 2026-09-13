import { createRoot } from "react-dom/client";

import "./app/globals.css";
import { PlanningWorkspace } from "./components/project-graph/PlanningWorkspace";

const root = document.getElementById("root");

if (!root) {
  throw new Error("AI 项目图谱嵌入页面缺少 root 容器。");
}

createRoot(root).render(<PlanningWorkspace />);
