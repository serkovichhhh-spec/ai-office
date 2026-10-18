import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Office",
  description: "Маркетинговий відділ з AI-агентів: брифи, запуски, затвердження.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#16222f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap&subset=cyrillic"
        />
        <style>{`:root{--font-ui:"Onest"}`}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
