import type { Metadata } from "next";
import { Workbench } from "@/components/analyze/Workbench";

export const metadata: Metadata = {
  title: "Analyze",
  description: "Race a mouse user, a keyboard-only user and a blind screen-reader user through the same task, then plan the fixes.",
};

export default function AnalyzePage() {
  return (
    // Temporary: the old Workbench until the workspace shell replaces this page.
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1360px] px-5 pb-12 pt-8 outline-none sm:px-8 sm:pt-10">
      <header className="mb-8 max-w-3xl">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-[1.75rem]">Analyze a page</h1>
        <p className="mt-2 text-base leading-relaxed text-muted">
          Pick a page and a task. Detour times a mouse, keyboard-only and screen-reader user, shows why anyone gets stuck, and plans the fixes.
        </p>
      </header>
      <Workbench />
    </main>
  );
}
