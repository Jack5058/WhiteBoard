import type { Metadata } from "next";
import "@excalidraw/excalidraw/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Board",
  description: "A collaborative whiteboard built with Next.js and Excalidraw.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
