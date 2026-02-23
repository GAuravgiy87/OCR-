/**
 * Root Layout Component
 * 
 * This is the root layout for the entire Next.js application.
 * It wraps all pages and provides the basic HTML structure.
 * 
 * Key Features:
 * - Sets up HTML and body tags
 * - Applies global CSS styles
 * - Defines metadata for SEO (title, description)
 * - Provides consistent structure across all pages
 * 
 * Note: ChatSidebar was removed from this layout as chat functionality
 * has been moved to a dedicated page at /chat
 * 
 * @module RootLayout
 */

import type { Metadata } from "next";
import "./globals.css";

/**
 * Metadata for the application
 * Used by Next.js for SEO and browser tab information
 */
export const metadata: Metadata = {
  title: "OCR App - Document Table Extraction with AI Chat",
  description: "Extract tables from PDFs and images with AI-powered OCR and chat assistant",
};

/**
 * Root layout component
 * 
 * Wraps all pages in the application with consistent HTML structure.
 * Children prop contains the page content that will be rendered.
 * 
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - The page content to render
 * @returns {JSX.Element} The root HTML structure
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
