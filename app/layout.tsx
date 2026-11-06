import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DataSourceProvider } from "@/components/DataSourceProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

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
  themeColor: "#f6f3ec",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-lime focus:px-5 focus:py-3 focus:font-bold focus:text-ink focus:no-underline focus:outline-3 focus:outline-ink"
        >
          Skip to main content
        </a>
        <SiteHeader />
        <DataSourceProvider>
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
        </DataSourceProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
