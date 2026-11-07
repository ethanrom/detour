import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/Workspace";

export const metadata: Metadata = {
  title: "Analyze",
  description: "Race a mouse user, a keyboard-only user and a blind screen-reader user through the same task, then plan the fixes.",
};

export default function AnalyzePage() {
  return <Workspace />;
}
