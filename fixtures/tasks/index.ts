// Demo sites and their hand-pinned tasks. Targets are data-detour-id values in public/sites/<id>/index.html.

import type { Task } from "@/lib/contracts";
import northwindTasks from "./northwind.json";
import riversideTasks from "./riverside.json";
import alpineTasks from "./alpine.json";

export interface DemoSite {
  id: string;
  name: string;
  tagline: string;
  /** Served by Next.js from public/ and loaded in a same-origin iframe. */
  path: string;
  /** demo: realistically inaccessible. control: built properly, so Detour should find little to fix. */
  kind: "demo" | "control";
  tasks: Task[];
}

export const SITES: DemoSite[] = [
  {
    id: "northwind",
    name: "Northwind Outfitters",
    tagline: "Outdoor gear store: Trail Jacket product page",
    path: "/sites/northwind/index.html",
    kind: "demo",
    tasks: northwindTasks as Task[],
  },
  {
    id: "riverside",
    name: "Riverside County: FreshStart Food Assistance",
    tagline: "County public-benefits page for food assistance",
    path: "/sites/riverside/index.html",
    kind: "demo",
    tasks: riversideTasks as Task[],
  },
  {
    id: "alpine",
    name: "Alpine Co-op",
    tagline: "A well-built control page: Summit Jacket product page",
    path: "/sites/alpine/index.html",
    kind: "control",
    tasks: alpineTasks as Task[],
  },
];
