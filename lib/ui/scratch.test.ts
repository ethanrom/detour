// @vitest-environment jsdom
import path from "node:path";
import { JSDOM } from "jsdom";
import { it } from "vitest";
import { extractPage } from "@/lib/extract";
import { SITES } from "@/fixtures/tasks";
import { evaluateAll } from "./pipeline";

it("scratch", async () => {
  for (const id of ["riverside"]) {
    const dom = await JSDOM.fromFile(path.resolve(__dirname, "../../public/sites", id, "index.html"), { resources: "usable", pretendToBeVisual: true });
    const { document } = dom.window;
    if (document.readyState !== "complete") await new Promise<void>((resolve) => dom.window.addEventListener("load", () => resolve()));
    const page = extractPage(document);
    const tasks = SITES.find((s) => s.id === id)!.tasks;
    for (const t of tasks) console.log(t.id, JSON.stringify(t.steps.map((s) => [s.target, !!page.nodes[s.target]])));
    const res = evaluateAll(page, tasks);
    console.log(JSON.stringify(res.map((r) => [r.taskId, r.personas.mouse.seconds, r.personas.keyboard.seconds, r.personas.screenreader.seconds, !!r.personas.screenreader.search])));
  }
});
