import type { Metadata } from "next";
import "./globals.css";
import ChatSidebar from "../components/ChatSidebar";

export const metadata: Metadata = {
  title: "OCR App - Document Table Extraction with AI Chat",
  description: "Extract tables from PDFs and images with AI-powered OCR and chat assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ChatSidebar />
      </body>
    </html>
  );
}
