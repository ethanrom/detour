import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DataSourceProvider } from "@/components/DataSourceProvider";

export const metadata: Metadata = {
  title: {
    default: "Detour: accessibility, measured in seconds",
    template: "%s · Detour",
  },
  description:
    "Detour predicts how many seconds a task takes for a mouse user, a keyboard-only user and a blind screen-reader user, then proposes the smallest set of code fixes that wins the most time back.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f9fa",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        {/* Switzer (Fontshare, ITF Free Font License) is not on Google Fonts, so next/font cannot self-host it here. */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-lime focus:px-5 focus:py-3 focus:font-bold focus:text-ink focus:no-underline focus:outline-3 focus:outline-ink"
        >
          Skip to main content
        </a>
        {/* Each route group brings its own chrome and its own <main id="main">: (site) for Home and Method, analyze for the workspace. */}
        <DataSourceProvider>{children}</DataSourceProvider>
      </body>
    </html>
  );
}
