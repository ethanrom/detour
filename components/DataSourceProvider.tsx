"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DataSource, DataSourceMode } from "@/lib/ui/datasource";
import { createLiveDataSource } from "@/lib/ui/live-datasource";
import { mockDataSource } from "@/lib/ui/mock-datasource";

// Live by default: extract the page from the preview iframe, evaluate and plan in a Web Worker.
// If the iframe cannot be read, analyze() falls back to the sample data and marks the analysis "sample".
const DEFAULT_SOURCE: DataSource = createLiveDataSource({ fallback: mockDataSource });
const DEFAULT_MODE: DataSourceMode = "live";

interface Ctx {
  source: DataSource;
  mode: DataSourceMode;
}

const DataSourceContext = createContext<Ctx>({ source: DEFAULT_SOURCE, mode: DEFAULT_MODE });

export function DataSourceProvider({
  children,
  source = DEFAULT_SOURCE,
  mode = DEFAULT_MODE,
}: {
  children: ReactNode;
  source?: DataSource;
  mode?: DataSourceMode;
}) {
  return <DataSourceContext.Provider value={{ source, mode }}>{children}</DataSourceContext.Provider>;
}

export function useDataSource(): DataSource {
  return useContext(DataSourceContext).source;
}

export function useDataSourceMode(): DataSourceMode {
  return useContext(DataSourceContext).mode;
}
