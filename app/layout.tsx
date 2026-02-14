import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Image Text Extractor",
  description: "Extract text from images with OCR",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
