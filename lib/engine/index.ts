// Detour engine: predicts task time for a mouse user, a keyboard-only user and a screen-reader
// user from a PageModel, using KLM-GOMS, Fitts's law and shortest paths over the accessibility tree.

export { evaluate, evaluateWithParams, DEFAULT_SAMPLES, DEFAULT_SEED } from "./evaluate";
export { nominalParams, sampleParams, mulberry32, deriveSeed, triangular, uniform, lognormal, lognormalSigma, standardNormal, sampleRange } from "./params";
export type { Params, ParamKey, Rng } from "./params";
export { dijkstra, pathEdges } from "./dijkstra";
export type { EdgeFn, Relax, ShortestPaths, PathEdge } from "./dijkstra";
export { costOf, speechSeconds, zeroCost, addCost } from "./cost";
export type { CostVec, CostInput } from "./cost";
export { TraceBuilder } from "./trace";
export type { Planned } from "./trace";
export { planMouse } from "./mouse";
export { planKeyboard } from "./keyboard";
export { planScreenReader, findQuery, SCREEN_READER_STRATEGIES, VERIFY_LABEL } from "./screenreader";
export type { ScreenReaderStrategy } from "./screenreader";
export { planPersona, summarise, mixture, priorWeights, personaStrategies, PERSONAS } from "./persona";
export { sampleSeconds, sampleSecondsReoptimised, quantile } from "./montecarlo";
export { explain } from "./explain";
export { getIndex, PageIndex } from "./pageindex";
