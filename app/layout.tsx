import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 项目图谱",
  description: "以软件架构为中心组织 AI 编程项目、上下文、任务、对话与代码证据。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
