"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DataSource, DataSourceMode } from "@/lib/ui/datasource";
import { mockDataSource } from "@/lib/ui/mock-datasource";

// ---------------------------------------------------------------------------------------------
// INTEGRATOR: this is the one line to change to plug in the real pipeline.
//   import { createLiveDataSource } from "@/lib/ui/live-datasource";
//   const DEFAULT_SOURCE: DataSource = createLiveDataSource();
//   const DEFAULT_MODE: DataSourceMode = "live";
// ---------------------------------------------------------------------------------------------
const DEFAULT_SOURCE: DataSource = mockDataSource;
const DEFAULT_MODE: DataSourceMode = "sample";

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
