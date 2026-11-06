@AGENTS.md

# Detour

Detour predicts how many **seconds** a task takes on a web page for a mouse user, a keyboard-only user
and a blind screen-reader user. It does this with established HCI models: KLM-GOMS, Fitts's law, and
screen-reader navigation as shortest paths over the accessibility tree. It then picks the smallest set of
code fixes that saves the most time. The LLM only grounds natural-language tasks to page elements. It
never produces numbers.

## Layout and ownership

Edit only the paths your task owns. If you need a change elsewhere, say so in your final report.

| Path | Contents |
|---|---|
| `lib/contracts/` | Shared types. **Frozen**: never edit. Ask the lead in your report if a type is wrong. |
| `lib/a11y/announce.ts` | NVDA-style announcement printer, shared. Frozen. |
| `lib/extract/` | Document → PageModel |
| `lib/engine/` | cost models, navigation graphs, Dijkstra, strategies, mixture, Monte Carlo |
| `lib/fixes/` | fix candidates, applyFix, optimiser |
| `lib/params/literature.ts` | human-performance parameters with sources |
| `lib/llm/`, `app/api/ground/` | Bedrock grounding |
| `public/sites/` | demo sites (static HTML/CSS) |
| `fixtures/` | `pagemodels/` (test PageModels plus `builder.ts`), `tasks/`, `results/` |
| `app/`, `components/` | UI |
| `docs/` | public docs (committed) |
| `internal/` | gitignored: plans, research notes, drafts. Keep internal notes there. |

## Rules

- TypeScript strict. No `any` across module boundaries. Import shared types from `@/lib/contracts`.
- Tests: keep them lean. A few tests per module that guard core correctness. No exhaustive/property/perf
  suites unless the lead asks. DOM tests use `// @vitest-environment jsdom` at the top of the file.
- Gates before you finish: `npm run typecheck` and `npm test` must pass. Run `npm run build`
  if you touched `app/`.
- Next.js is **16.4**: read `node_modules/next/dist/docs/` before using framework APIs.
  React is 19.3 and Tailwind is 4.
- Dependencies are pre-installed. Avoid adding packages. If you must, list them in your report.
- Commit on your own branch with clear, plain messages. **No "Co-Authored-By" or AI-attribution lines.** Never commit `.env*` or secrets.
  Do not push, merge or rebase other branches.
- Python, if ever needed: `uv run --with <pkg> python ...`. Never install into the base interpreter.
- Shell is Git Bash on Windows. Use forward slashes.
- Deterministic code produces every explanation and number shown to users. An LLM output is always
  validated before use, and every LLM path has a fixture fallback that works without keys.
- Accessibility of our own UI: WCAG 2.2 AA, fully keyboard operable, respects `prefers-reduced-motion`.

## Commands

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # next typegen + tsc
npm test           # vitest (unit + property)
npm run build
npm run e2e        # playwright (uses installed Chrome)
```

## Environment (.env at repo root, never committed)
`CLAUDE_AWS_ACCESS_KEY`, `CLAUDE_AWS_SECRET_KEY` and `CLAUDE_AWS_REGION` hold the Bedrock credentials.
`CLAUDE_AWS_MODEL` (strong) and `CLAUDE_AWS_FAST_MODEL` (fast) each take a model id, an inference
profile or an ARN, passed unchanged as the Converse `modelId`. Never hard-code a model id.
`OPENAI_API_KEY` is only used for demo video narration.
