import type { Metadata } from "next";
import { Workbench } from "@/components/analyze/Workbench";

export const metadata: Metadata = {
  title: "Analyze",
  description: "Race a mouse user, a keyboard-only user and a blind screen-reader user through the same task, then plan the fixes.",
};

export default function AnalyzePage() {
  return (
    <div className="mx-auto w-full max-w-[1360px] px-5 pb-8 pt-6 sm:px-8 sm:pt-8">
      <header className="mb-6 max-w-3xl">
        <p className="eyebrow">Workbench</p>
        <h1 className="display mt-2.5 text-3xl sm:text-[2.6rem]">
          Race three people through <span className="mark">one page</span>
        </h1>
        <p className="lede mt-2">Pick a page and a task. Detour predicts the seconds it takes, shows why, and plans the smallest set of fixes.</p>
      </header>
      <Workbench />
    </div>
  );
}
